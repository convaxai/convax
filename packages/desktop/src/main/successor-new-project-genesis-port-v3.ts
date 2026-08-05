import {
  createSelectedDocumentOwnerArtifactFactoryV2,
  ordinarySha256V2,
  parseDigestV2,
  parseDocumentScopeV2,
  parseId128V2,
  selectedSuccessorValidationArtifactSetV3,
  structuredDigestV2,
  type CollaborationKernelOptionsV2,
  type DigestV2,
  type DocumentOwnerRuntimeV2,
  type Id128V2,
  type IncomingOwnerFactResolverPortV3,
  type OwnerExternalFactRequirementV2,
  type LocalProjectOwnerBindingV3,
  type ReplicaSignerPortV2,
  type SignatureV2,
  type VerifiedProtocolAuthorityV2,
  type VerifiedProtocolAuthorityV3,
} from "@convax/collaboration"
import {
  createCanvasReconstructionYDocV2,
  createLocalOwnerCanvasGenesisCandidateV3,
  requiredCanvasBlobDigestsV2,
  selectedCanvasDocumentOwnerArtifactDefinitionV2,
  type LocalOwnerCanvasGenesisSignerPortV3,
} from "@convax/canvas/collaboration"
import {
  createProjectIndexGenesisRoutePublicationV3,
  type ProjectIndexFactResolutionPortV2,
  type ProjectIndexGenesisRoutePublicationV3,
} from "@convax/project/canvas"
import {
  createProjectIndexReconstructionYDocV2,
  decodeProjectIndexCanvasGenesisCurrentnessRequestV2,
  requiredProjectIndexBlobDigestsV2,
} from "@convax/project"
import {
  createLocalOwnerProjectIndexGenesisCandidateV3,
  publishLocalOwnerProjectIndexGenesisV3,
  type SuccessorNewProjectGenesisPortV3,
  type NodeAcceptedReplicaHeadV2,
} from "@convax/project/node"

import { createKernelBackedMainCollaborationDocumentSessionV3 } from "./collaboration-document-session"
import type { MainCollaborationDocumentSessionV3 } from "./collaboration-document-session"
import type { MainProjectCollaborationProductionRuntimeV3 } from "./successor-collaboration-production-runtime"
import type { ClaimBoundProvisioningAuthoritySourcesV3 } from "./claim-bound-provisioning-authority-v3"

export interface SuccessorGenesisIdFactoryV3 {
  derive(input: Readonly<{
    claimDigest: DigestV2
    purpose: "project-index-genesis-operation" | "project-index-genesis-checkpoint" |
      "default-canvas-route-stage" | "default-canvas-genesis-checkpoint" |
      "default-canvas-route-activation"
  }>): Id128V2
}

export interface SuccessorGenesisSignerSourceV3 {
  open(input: Readonly<{ binding: LocalProjectOwnerBindingV3 }>): Promise<ReplicaSignerPortV2 | "missing" | "rejected">
}

/**
 * Production Project/node adapter for the sealed V11 provisioning sequence.
 * The supplied runtime must itself be claim-bound: it may resolve only the
 * binding/authorization/bridge passed by the in-progress provisioner. Presence
 * of successor files is not authority and this adapter never opens Team state.
 */
export function createSuccessorNewProjectGenesisPortV3(input: Readonly<{
  authority: VerifiedProtocolAuthorityV3
  historicalAuthority: VerifiedProtocolAuthorityV2
  runtime: MainProjectCollaborationProductionRuntimeV3
  projectIndexOwner: DocumentOwnerRuntimeV2<"project-index">
  projectIndexIncomingFacts: IncomingOwnerFactResolverPortV3
  projectIndexFacts: ProjectIndexFactResolutionPortV2
  signatureVerifier: CollaborationKernelOptionsV2["signatureVerifier"]
  ids: SuccessorGenesisIdFactoryV3
  signers: SuccessorGenesisSignerSourceV3
  provisioningAuthority?: Pick<ClaimBoundProvisioningAuthoritySourcesV3, "bindProjectIndex">
  defaultCanvasTitle?: string
}>): SuccessorNewProjectGenesisPortV3 & Readonly<{ dispose(): Promise<void> }> {
  const validationArtifacts = selectedSuccessorValidationArtifactSetV3(input.authority, input.historicalAuthority)
  const validationArtifactSetDigest = structuredDigestV2("convax.validation-artifact-set/2", validationArtifacts)
  let projectIndexSession: MainCollaborationDocumentSessionV3<"project-index"> | undefined
  let routePublication: ProjectIndexGenesisRoutePublicationV3 | undefined
  let projectIndexRuntime: Awaited<ReturnType<typeof input.runtime.openDocument<"project-index">>> | undefined
  let openedProjectIndexScope: ReturnType<typeof requireProjectIndexScope> | undefined
  let publishedCanvasGenesis: Readonly<{
    scope: ReturnType<typeof requireCanvasScope>
    predecessorFrameDigest: DigestV2
    stagedProjectIndexFrontierDigest: DigestV2
    checkpointObjectDigest: DigestV2
  }> | undefined
  let disposed = false

  const projectIndexFacts: ProjectIndexFactResolutionPortV2 = Object.freeze({
    async resolve(request: Parameters<ProjectIndexFactResolutionPortV2["resolve"]>[0]) {
      if (!request.dependencies.externalFacts.some((fact) => fact.kind === "canvas-genesis-currentness")) {
        return input.projectIndexFacts.resolve(request)
      }
      if (!publishedCanvasGenesis || request.dependencies.validationArtifacts.length !== 0) {
        return Object.freeze({ status: "pending" as const })
      }
      const values = new Map<string, unknown>()
      for (const requirement of request.dependencies.externalFacts) {
        if (
          requirement.kind !== "canvas-genesis-currentness" ||
          ordinarySha256V2(requirement.request.exactJcs) !== requirement.request.sha256 ||
          requirement.factDigest !== requirement.request.sha256
        ) return Object.freeze({ status: "rejected" as const })
        const decoded = decodeProjectIndexCanvasGenesisCurrentnessRequestV2(requirement.request.exactJcs)
        if (
          decoded === "rejected" || !sameScope(decoded.canvasScope, publishedCanvasGenesis.scope) ||
          decoded.routeDependencyFrameDigest !== publishedCanvasGenesis.predecessorFrameDigest ||
          decoded.stagedProjectIndexFrontierDigest !== publishedCanvasGenesis.stagedProjectIndexFrontierDigest ||
          decoded.genesisCheckpointObjectDigest !== publishedCanvasGenesis.checkpointObjectDigest
        ) return Object.freeze({ status: "rejected" as const })
        values.set(requirement.factDigest, Object.freeze({
          format: "convax.project-index-external-fact-result/2",
          kind: requirement.kind,
          requestSha256: requirement.request.sha256,
          factDigest: requirement.factDigest,
          decision: "verified",
        }))
      }
      const created = input.projectIndexOwner.externalFactPortFactory.createAttemptPort({
        declared: request.dependencies,
        resolver: Object.freeze({
          owner: "project-index" as const,
          resolveArtifact: () => Object.freeze({ status: "rejected" as const, code: "artifact-not-declared" as const }),
          resolveFact(requirement: OwnerExternalFactRequirementV2<"project-index">) {
            const value = values.get(requirement.factDigest)
            return value === undefined
              ? Object.freeze({ status: "rejected" as const, code: "fact-not-declared" as const })
              : Object.freeze({ status: "resolved" as const, requirement, value })
          },
        }),
      })
      return created.status === "created"
        ? Object.freeze({ status: "resolved" as const, port: created.port })
        : Object.freeze({ status: "rejected" as const })
    },
  })

  const port: SuccessorNewProjectGenesisPortV3 & Readonly<{ dispose(): Promise<void> }> = {
    async publishProjectIndexGenesis({ claimDigest, binding, authorization }) {
      requireLive()
      const scope = requireProjectIndexScope(authorization.core.scope)
      requireBindingScope(binding, scope)
      const signer = await requireSigner(binding)
      const candidate = await createLocalOwnerProjectIndexGenesisCandidateV3({
        scope,
        operationId: id(claimDigest, "project-index-genesis-operation"),
        checkpointId: id(claimDigest, "project-index-genesis-checkpoint"),
        binding,
        authorization,
        protocolDigest: input.authority.protocolDigest,
        uriProtocolDigest: input.historicalAuthority.protocolSchemaBundle.core.uriProtocolDigest,
        validationArtifactSetDigest,
        signer: projectIndexPurposeSigner(signer),
      })
      return publishLocalOwnerProjectIndexGenesisV3({ candidate, store: input.runtime.persistence })
    },

    async stageDefaultCanvasRoute({ claimDigest, stageOperationId, binding, projectIndex, projectIndexAuthorization, projectIndexBridge, expectedCanvasScope }) {
      requireLive()
      const scope = requireCanvasScope(expectedCanvasScope)
      requireBindingScope(binding, scope)
      if (projectIndexBridge.core.scope.docKind !== "project-index" ||
        projectIndexBridge.core.successorProtocolDigest !== input.authority.protocolDigest) {
        throw new Error("ProjectIndex promotion bridge does not authorize the selected successor")
      }
      await input.provisioningAuthority?.bindProjectIndex({ claimDigest, binding })
      const publication = await openProjectIndexPublication(projectIndexAuthorization.core.scope)
      const existing = await publication.inspect({ scope })
      if (existing === "live") throw new Error("Default Canvas route is already live before genesis publication")
      if (existing === "absent") {
        const committed = await publication.stage({
          scope,
          operationId: parseId128V2(stageOperationId),
          title: input.defaultCanvasTitle ?? "Canvas 1",
        })
        return Object.freeze({
          scope,
          predecessorFrameDigest: committed.frame.frameDigest,
          acceptedFrontierDigest: committed.acceptedFrontierDigest,
        })
      }
      if (existing !== "staged") throw new Error("Default Canvas route recovery is ambiguous")
      const durable = requireDurableHead(await input.runtime.persistence.loadReplicaHead(requireProjectIndexScope(projectIndexAuthorization.core.scope)))
      if (durable.headDigest === projectIndex.acceptedHeadDigest ||
        durable.frontierDigest === projectIndex.acceptedFrontierDigest) {
        throw new Error("Recovered staged route has no distinct durable ProjectIndex frame")
      }
      return Object.freeze({
        scope,
        predecessorFrameDigest: parseDigestV2(durable.headDigest),
        acceptedFrontierDigest: parseDigestV2(durable.frontierDigest),
      })
    },

    async publishDefaultCanvasGenesis({ claimDigest, binding, stagedRoute, canvasAuthorization }) {
      requireLive()
      const scope = requireCanvasScope(stagedRoute.scope)
      requireBindingScope(binding, scope)
      const signer = await requireSigner(binding)
      const candidate = await createLocalOwnerCanvasGenesisCandidateV3({
        scope,
        projectIndexRouteDependencyFrameDigest: parseDigestV2(stagedRoute.predecessorFrameDigest),
        checkpointId: id(claimDigest, "default-canvas-genesis-checkpoint"),
        binding,
        authorization: canvasAuthorization,
        protocolDigest: input.authority.protocolDigest,
        validationArtifactSetDigest,
        signer: canvasPurposeSigner(signer),
      })
      try {
        if (candidate.checkpoint.core.projectIndexRouteDependencyFrameDigest !== stagedRoute.predecessorFrameDigest) {
          throw new Error("Canvas genesis checkpoint crossed its accepted ProjectIndex route")
        }
        let durable: Awaited<ReturnType<typeof input.runtime.persistence.initializeShardWithGenesisProof>> | undefined
        const selectedCanvasOwner = createSelectedDocumentOwnerArtifactFactoryV2(input.historicalAuthority, "canvas")
          .createRuntime(selectedCanvasDocumentOwnerArtifactDefinitionV2)
        if ("status" in selectedCanvasOwner) throw new Error(`Canvas owner runtime is ${selectedCanvasOwner.code}`)
        try {
          await input.runtime.openDocument({
            scope,
            owner: selectedCanvasOwner,
            incomingFacts: Object.freeze({ async resolve() { return Object.freeze({ status: "rejected" as const }) } }),
            createDocument: createCanvasReconstructionYDocV2,
            requiredBlobDigests: requiredCanvasBlobDigestsV2,
            prepareShard: async () => {
              durable = await input.runtime.persistence.initializeShardWithGenesisProof(Object.freeze({
                scope,
                checkpointObjectDigest: candidate.checkpointObjectDigest,
                checkpointExactBytes: candidate.checkpointExactBytes,
                proofCarrierExactBytes: candidate.proofExactBytes,
                acceptedBase: candidate.acceptedBase,
              }))
            },
          })
        } finally {
          await input.runtime.closeDocument(scope)
        }
        if (!durable) throw new Error("Canvas genesis durability did not complete")
        publishedCanvasGenesis = Object.freeze({
          scope,
          predecessorFrameDigest: parseDigestV2(stagedRoute.predecessorFrameDigest),
          stagedProjectIndexFrontierDigest: parseDigestV2(stagedRoute.acceptedFrontierDigest),
          checkpointObjectDigest: candidate.checkpointObjectDigest,
        })
        if (durable.frontierDigest !== candidate.acceptedBase.frontierDigest ||
          durable.canonicalStateDigest !== candidate.acceptedBase.canonicalStateDigest) {
          throw new Error("Durable Canvas genesis differs from its owner-authored candidate")
        }
        return Object.freeze({
          authorizationProofDigest: candidate.proofDigest,
          durableCheckpointDigest: candidate.checkpointObjectDigest,
          acceptedHeadDigest: durable.headDigest,
          acceptedFrontierDigest: durable.frontierDigest,
        })
      } finally {
        candidate.document.destroy()
      }
    },

    async activateDefaultCanvasRoute({ claimDigest, stagedRoute, canvasGenesis, canvasBridge }) {
      requireLive()
      const scope = requireCanvasScope(stagedRoute.scope)
      if (canvasBridge.core.successorProtocolDigest !== input.authority.protocolDigest ||
        !sameScope(canvasBridge.core.scope, scope)) {
        throw new Error("Canvas promotion bridge crossed the staged route")
      }
      const publication = routePublication
      if (!publication) throw new Error("ProjectIndex route publication was not opened")
      await publication.activate({
        scope,
        operationId: id(claimDigest, "default-canvas-route-activation"),
        predecessorFrameDigest: stagedRoute.predecessorFrameDigest,
        stagedProjectIndexFrontierDigest: stagedRoute.acceptedFrontierDigest,
        canvasGenesisCheckpointObjectDigest: canvasGenesis.durableCheckpointDigest,
      })
    },

    async dispose() {
      if (disposed) return
      disposed = true
      projectIndexSession?.dispose()
      if (openedProjectIndexScope) await input.runtime.closeDocument(openedProjectIndexScope)
      projectIndexSession = undefined
      projectIndexRuntime = undefined
      openedProjectIndexScope = undefined
      routePublication = undefined
    },
  }
  return Object.freeze(port)

  async function openProjectIndexPublication(scopeInput: Parameters<typeof requireProjectIndexScope>[0]) {
    if (routePublication) return routePublication
    const scope = requireProjectIndexScope(scopeInput)
    openedProjectIndexScope = scope
    projectIndexRuntime = await input.runtime.openDocument({
      scope,
      owner: input.projectIndexOwner,
      incomingFacts: input.projectIndexIncomingFacts,
      createDocument: createProjectIndexReconstructionYDocV2,
      requiredBlobDigests: requiredProjectIndexBlobDigestsV2,
    })
    projectIndexSession = await createKernelBackedMainCollaborationDocumentSessionV3({
      authority: input.authority,
      historicalAuthority: input.historicalAuthority,
      scope,
      owner: input.projectIndexOwner,
      ports: projectIndexRuntime.ports,
      signatureVerifier: input.signatureVerifier,
      createOperationId: () => { throw new Error("Successor genesis route operations require claim-derived identities") },
    })
    routePublication = createProjectIndexGenesisRoutePublicationV3({
      session: projectIndexSession,
      facts: projectIndexFacts,
    })
    return routePublication
  }

  async function requireSigner(binding: LocalProjectOwnerBindingV3): Promise<ReplicaSignerPortV2> {
    const signer = await input.signers.open({ binding })
    if (typeof signer === "string") throw new Error(`Local owner genesis signer is ${signer}`)
    return signer
  }
  function id(claimDigest: DigestV2, purpose: Parameters<SuccessorGenesisIdFactoryV3["derive"]>[0]["purpose"]) {
    return parseId128V2(input.ids.derive({ claimDigest: parseDigestV2(claimDigest), purpose }))
  }
  function requireLive() { if (disposed) throw new Error("Successor genesis port is disposed") }
}

function projectIndexPurposeSigner(signer: ReplicaSignerPortV2) {
  return Object.freeze({
    async sign({ purpose, exactPurposeBytes }: Readonly<{ purpose: "project-index-genesis-checkpoint"; coreDigest: DigestV2; exactPurposeBytes: Uint8Array }>): Promise<SignatureV2> {
      if (purpose !== "project-index-genesis-checkpoint") throw new Error("Local owner genesis signing purpose crossed its adapter")
      return signer.sign(exactPurposeBytes)
    },
  })
}
function canvasPurposeSigner(signer: ReplicaSignerPortV2): LocalOwnerCanvasGenesisSignerPortV3 {
  return Object.freeze({
    async sign({ purpose, exactPurposeBytes }: Parameters<LocalOwnerCanvasGenesisSignerPortV3["sign"]>[0]) {
      if (purpose !== "canvas-genesis-checkpoint") throw new Error("Local owner genesis signing purpose crossed its adapter")
      return signer.sign(exactPurposeBytes)
    },
  })
}

function requireProjectIndexScope(scopeInput: Parameters<typeof parseDocumentScopeV2>[0]) {
  const scope = parseDocumentScopeV2(scopeInput)
  if (scope.docKind !== "project-index" || scope.docId !== "project-index") throw new Error("Successor genesis requires ProjectIndex scope")
  return scope as typeof scope & { readonly docKind: "project-index"; readonly docId: "project-index" }
}
function requireCanvasScope(scopeInput: Parameters<typeof parseDocumentScopeV2>[0]) {
  const scope = parseDocumentScopeV2(scopeInput)
  if (scope.docKind !== "canvas") throw new Error("Successor genesis requires Canvas scope")
  return scope as typeof scope & { readonly docKind: "canvas" }
}
function requireBindingScope(binding: LocalProjectOwnerBindingV3, scope: ReturnType<typeof parseDocumentScopeV2>) {
  if (binding.core.projectId !== scope.projectId || binding.core.projectEpoch !== scope.projectEpoch) throw new Error("Local owner binding crossed genesis scope")
}
function sameScope(left: ReturnType<typeof parseDocumentScopeV2>, right: ReturnType<typeof parseDocumentScopeV2>) {
  const parsed = parseDocumentScopeV2(left)
  return parsed.projectId === right.projectId && parsed.projectEpoch === right.projectEpoch && parsed.docKind === right.docKind && parsed.docId === right.docId && parsed.shardEpoch === right.shardEpoch
}
function requireDurableHead(value: unknown): NodeAcceptedReplicaHeadV2 {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("ProjectIndex durable head is unavailable")
  const head = value as NodeAcceptedReplicaHeadV2
  parseDocumentScopeV2(head.scope)
  parseDigestV2(head.headDigest)
  parseDigestV2(head.frontierDigest)
  parseDigestV2(head.canonicalStateDigest)
  return head
}
