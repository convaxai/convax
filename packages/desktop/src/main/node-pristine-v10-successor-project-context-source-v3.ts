import fs from "node:fs/promises"
import path from "node:path"

import {
  createSelectedIncomingAuthorityVerificationPortV3,
  parseDigestV2,
  parseDocumentScopeV2,
  parseProjectIdV2,
  type CollaborationKernelOptionsV2,
  type DigestV2,
  type DecodedCausalEditFrameV3,
  type DocumentOwnerRuntimeV2,
  type Id128V2,
  type SuccessorIncomingAuthorityProofResolverPortV3,
  type VerifiedProtocolAuthorityV2,
  type VerifiedProtocolAuthorityV3,
} from "@convax/collaboration"
import { CANVAS_PROTOCOL_SCHEMA_ARTIFACT_DIGEST_V2 } from "@convax/canvas/collaboration"
import {
  PROJECT_INDEX_PROTOCOL_SCHEMA_ARTIFACT_DIGEST_V2,
  createProjectIndexReconstructionYDocV2,
  requiredProjectIndexBlobDigestsV2,
} from "@convax/project"
import {
  NodeSuccessorLocalOwnerAuthorityStoreV3,
  NodeSuccessorProjectIndexBridgeJournalSourceV3,
  NodeSuccessorProjectProtocolStateStoreV3,
  ProjectBlobReplicationStoreV2,
  ProjectIndexFileMaterializerV2,
  SuccessorLocalProjectProvisionerV3,
  deriveEmptyProjectDefaultCanvasClaimV3,
  readProjectNativeStoreManifestV2,
  type EmptyProjectDefaultCanvasClaimSourceV3,
  type ProjectCollaborationRuntimeLeaseV2,
  type OpenSuccessorProjectProtocolStateV3,
} from "@convax/project/node"

import type { CanvasApplicationCommandAdapterV2 } from "./canvas-collaboration-session-owner"
import { createClaimBoundProvisioningAuthoritySourcesV3 } from "./claim-bound-provisioning-authority-v3"
import type { NodeDurableTeamAuthorityStoreV1 } from "./durable-team-authority-store"
import { ElectronLocalOwnerSigningVaultV3 } from "./electron-local-owner-signing-vault-v3"
import type { ElectronReplicaSigningVaultV2 } from "./electron-replica-signing-vault"
import type { NodeDurableLocalProjectOwnerAuthorityV2 } from "./local-project-owner-authority"
import { createCurrentLocalOwnerAuthoritySourceV3 } from "./local-owner-authority-source-v3"
import { createMainLocalProjectCollaborationPortsV3 } from "./main-local-project-collaboration-ports-v3"
import { createMainProjectIndexOwnerRuntimeV2 } from "./main-project-index-runtime-registry"
import { createLocalBlobProjectIndexFactPortsV2 } from "./project-index-external-facts"
import type {
  ClaimBoundPristineV10PromotionRuntimeV3,
  PristineV10SuccessorProjectContextSourceV3,
  PristineV10SuccessorProjectContextV3,
} from "./pristine-v10-successor-project-factory-v3"
import {
  createMainProjectCollaborationProductionRuntimeV3,
  type MainProjectCollaborationProductionRuntimeV3,
} from "./successor-collaboration-production-runtime"
import { createExactSuccessorLocalAuthoritySourcesV3 } from "./successor-local-authority-adapters"
import {
  createSuccessorNewProjectGenesisPortV3,
  type SuccessorGenesisIdFactoryV3,
  type SuccessorGenesisSignerSourceV3,
} from "./successor-new-project-genesis-port-v3"
import { VerifiedV10PromotionInspectionAdapterV3 } from "./verified-v10-promotion-inspection"

export interface SuccessorProjectRootSourceV3 {
  resolveProjectRoot(input: { readonly projectId: string }): Promise<string>
}

/** Real native context source. Its dependency list intentionally has no Team runtime or network client. */
export class NodePristineV10SuccessorProjectContextSourceV3
  implements PristineV10SuccessorProjectContextSourceV3
{
  constructor(private readonly options: Readonly<{
    authority: VerifiedProtocolAuthorityV3
    historicalAuthority: VerifiedProtocolAuthorityV2
    deviceRootDirectory: string
    projects: SuccessorProjectRootSourceV3
    legacyOwners: NodeDurableLocalProjectOwnerAuthorityV2
    teamAuthority: Pick<NodeDurableTeamAuthorityStoreV1, "open">
    replicaVault: ElectronReplicaSigningVaultV2
    signatureVerifier: CollaborationKernelOptionsV2["signatureVerifier"]
    applicationCommands: CanvasApplicationCommandAdapterV2
    createOperationId: () => Id128V2
    createShardEpoch: () => Id128V2
    createSessionId: () => Id128V2
    createCursorToken: () => Id128V2
    genesisIds: SuccessorGenesisIdFactoryV3
  }>) {
    if (!path.isAbsolute(options.deviceRootDirectory)) throw new TypeError("Successor device root must be absolute")
  }

  async open(projectIdInput: ReturnType<typeof parseProjectIdV2>): Promise<PristineV10SuccessorProjectContextV3> {
    const projectId = parseProjectIdV2(projectIdInput)
    await fs.mkdir(this.options.deviceRootDirectory, { recursive: true, mode: 0o700 })
    const deviceRootStat = await fs.lstat(this.options.deviceRootDirectory)
    if (!deviceRootStat.isDirectory() || deviceRootStat.isSymbolicLink()) {
      throw new Error("Successor device root must be a plain directory")
    }
    const projectRoot = await this.options.projects.resolveProjectRoot({ projectId })
    if (!path.isAbsolute(projectRoot) || path.resolve(projectRoot) !== projectRoot) {
      throw new Error("Successor Project root must be canonical and absolute")
    }
    const projectPrivateDirectory = path.join(projectRoot, ".convax")
    const collaborationDirectory = path.join(projectPrivateDirectory, "collaboration")
    const manifest = await readProjectNativeStoreManifestV2(collaborationDirectory, {
      protocolDigest: this.options.historicalAuthority.protocolDigest,
      schemaDigest: PROJECT_INDEX_PROTOCOL_SCHEMA_ARTIFACT_DIGEST_V2,
      uriProtocolDigest: this.options.historicalAuthority.protocolSchemaBundle.core.uriProtocolDigest,
    })
    if (manifest.projectIndexScope.projectId !== projectId) throw new Error("V10 manifest crossed Project identity")
    const projectEpoch = manifest.projectIndexScope.projectEpoch
    const ownerStore = new NodeSuccessorLocalOwnerAuthorityStoreV3({
      projectPrivateDirectory,
      deviceAuthorityDirectory: path.join(this.options.deviceRootDirectory, "owner-authority"),
    })
    const protocolStore = new NodeSuccessorProjectProtocolStateStoreV3({
      projectPrivateDirectory,
      deviceProtocolDirectory: path.join(this.options.deviceRootDirectory, "protocol-state"),
    })
    const signingVault = new ElectronLocalOwnerSigningVaultV3(this.options.replicaVault)
    let activeGenesis: ReturnType<typeof createSuccessorNewProjectGenesisPortV3> | undefined
    const genesisDelegate = {
      publishProjectIndexGenesis: (request: Parameters<ReturnType<typeof createSuccessorNewProjectGenesisPortV3>["publishProjectIndexGenesis"]>[0]) =>
        requireGenesis().publishProjectIndexGenesis(request),
      stageDefaultCanvasRoute: (request: Parameters<ReturnType<typeof createSuccessorNewProjectGenesisPortV3>["stageDefaultCanvasRoute"]>[0]) =>
        requireGenesis().stageDefaultCanvasRoute(request),
      publishDefaultCanvasGenesis: (request: Parameters<ReturnType<typeof createSuccessorNewProjectGenesisPortV3>["publishDefaultCanvasGenesis"]>[0]) =>
        requireGenesis().publishDefaultCanvasGenesis(request),
      activateDefaultCanvasRoute: (request: Parameters<ReturnType<typeof createSuccessorNewProjectGenesisPortV3>["activateDefaultCanvasRoute"]>[0]) =>
        requireGenesis().activateDefaultCanvasRoute(request),
    }
    const inspector = new VerifiedV10PromotionInspectionAdapterV3({
      authority: this.options.historicalAuthority,
      projects: this.options.projects,
      owners: this.options.legacyOwners,
      teamAuthority: this.options.teamAuthority,
      successorOwner: ownerStore,
      emptyProjectDefaultCanvas: Object.freeze({
        resolve: async (input: Parameters<EmptyProjectDefaultCanvasClaimSourceV3["resolve"]>[0]) => {
          const identity = await signingVault.resolveIdentity({
            claimDigest: parseDigestV2("0".repeat(64)),
            projectId: input.projectId,
            projectEpoch: input.projectEpoch,
          })
          return deriveEmptyProjectDefaultCanvasClaimV3({
            ...input,
            ownerActorId: identity.actorId,
          })
        },
      }),
    })
    const provisioner = new SuccessorLocalProjectProvisionerV3({
      projectPrivateDirectory,
      ownerStore,
      protocolStore,
      signers: signingVault,
      genesis: genesisDelegate,
      v10: inspector,
    })

    const context: PristineV10SuccessorProjectContextV3 = Object.freeze({
      projectId,
      projectEpoch,
      protocolStore,
      provisioner,
      openClaimBoundPromotion: async (claimDigest: DigestV2): Promise<ClaimBoundPristineV10PromotionRuntimeV3> => {
        if (activeGenesis) throw new Error("A claim-bound successor writer is already active")
        const identity = await signingVault.resolveIdentity({ claimDigest, projectId, projectEpoch })
        const signers = signerSource(this.options.replicaVault)
        const claimAuthority = createClaimBoundProvisioningAuthoritySourcesV3({
          protocolDigest: this.options.authority.protocolDigest,
          journal: new NodeSuccessorProjectIndexBridgeJournalSourceV3(projectPrivateDirectory),
          signers,
          sharingState: ownerStore,
          verifier: this.options.signatureVerifier,
        })
        const incomingAuthority = localIncomingAuthority(ownerStore, this.options.signatureVerifier)
        const runtime = await createMainProjectCollaborationProductionRuntimeV3({
          authority: this.options.authority,
          historicalAuthority: this.options.historicalAuthority,
          collaborationDirectory,
          actorId: identity.actorId,
          localAuthority: claimAuthority.localAuthority,
          promotionBridge: claimAuthority.promotionBridge,
          incomingAuthority,
        })
        const owner = createMainProjectIndexOwnerRuntimeV2(this.options.historicalAuthority)
        const blobs = await ProjectBlobReplicationStoreV2.open({
          collaborationDirectory,
          projectId,
          projectEpoch,
          // Blob presence is historical content evidence, not the active writer
          // protocol. Reuse the already-installed V10 index during promotion.
          protocolDigest: this.options.historicalAuthority.protocolDigest,
        })
        const facts = createLocalBlobProjectIndexFactPortsV2({
          factory: owner.externalFactPortFactory,
          scope: manifest.projectIndexScope,
          blobs,
        })
        activeGenesis = createSuccessorNewProjectGenesisPortV3({
          authority: this.options.authority,
          historicalAuthority: this.options.historicalAuthority,
          runtime,
          projectIndexOwner: owner,
          projectIndexIncomingFacts: facts.incomingFactsV3,
          projectIndexFacts: facts.facts,
          signatureVerifier: this.options.signatureVerifier,
          ids: this.options.genesisIds,
          signers,
          provisioningAuthority: claimAuthority,
        })
        let disposed = false
        return Object.freeze({
          async dispose() {
            if (disposed) return
            disposed = true
            const genesis = activeGenesis
            activeGenesis = undefined
            await genesis?.dispose()
            await runtime.dispose()
            claimAuthority.dispose()
          },
        })
      },
      openSelectedLocal: async (
        opened: Extract<OpenSuccessorProjectProtocolStateV3, { status: "v3-local" }>,
      ) => {
        const state = opened.state
        const projectIndexAuthorization = state.authorizations.find((entry) => entry.authorization.core.scope.docKind === "project-index")
        if (!projectIndexAuthorization) throw new Error("V3 local state has no ProjectIndex authorization")
        const parsedProjectIndexScope = parseDocumentScopeV2(projectIndexAuthorization.authorization.core.scope)
        if (parsedProjectIndexScope.docKind !== "project-index" || parsedProjectIndexScope.docId !== "project-index") {
          throw new Error("V3 local ProjectIndex authorization is invalid")
        }
        const projectIndexScope = parsedProjectIndexScope as typeof parsedProjectIndexScope & {
          readonly docKind: "project-index"
          readonly docId: "project-index"
        }
        const exact = createExactSuccessorLocalAuthoritySourcesV3({ ownerStore, protocolStore })
        const localAuthority = createCurrentLocalOwnerAuthoritySourceV3({
          records: exact.records,
          sharingState: ownerStore,
          verifier: this.options.signatureVerifier,
          signers: this.options.replicaVault,
        })
        const runtime = await createMainProjectCollaborationProductionRuntimeV3({
          authority: this.options.authority,
          historicalAuthority: this.options.historicalAuthority,
          collaborationDirectory,
          actorId: state.ownerBinding.core.initialActorId,
          localAuthority,
          promotionBridge: exact.promotionBridge,
          incomingAuthority: localIncomingAuthority(ownerStore, this.options.signatureVerifier),
        })
        const owner = createMainProjectIndexOwnerRuntimeV2(this.options.historicalAuthority)
        const blobs = await ProjectBlobReplicationStoreV2.open({
          collaborationDirectory,
          projectId,
          projectEpoch,
          protocolDigest: this.options.historicalAuthority.protocolDigest,
        })
        const facts = createLocalBlobProjectIndexFactPortsV2({
          factory: owner.externalFactPortFactory,
          scope: projectIndexScope,
          blobs,
        })
        return createMainLocalProjectCollaborationPortsV3({
          projectId,
          authority: this.options.authority,
          historicalAuthority: this.options.historicalAuthority,
          runtime,
          projectIndexScope,
          projectIndex: {
            owner,
            incomingFacts: facts.incomingFactsV3,
            createDocument: createProjectIndexReconstructionYDocV2,
            requiredBlobDigests: requiredProjectIndexBlobDigestsV2,
            facts: facts.facts,
            canvasGenesis: facts.canvasGenesis,
            blobs: { publish: ({ reference, exactBytes }) => blobs.admitVerifiedBytes(reference, exactBytes).then(() => undefined) },
            fileMaterialization: {
              open: (projection) => ProjectIndexFileMaterializerV2.open({ projectId, projectRoot, projection, blobs }),
              subscribeBlobPublished: (listener) => blobs.subscribePublished(() => listener()),
              reportFailure: (error) => console.error(`Failed to reconcile V3 Project files for ${projectId}`, error),
            },
          },
          projects: singletonProjectLease({
            projectId,
            projectRoot,
            collaborationDirectory,
            runtime,
            actorId: state.ownerBinding.core.initialActorId,
          }),
          signatureVerifier: this.options.signatureVerifier,
          applicationCommands: this.options.applicationCommands,
          createOperationId: this.options.createOperationId,
          createShardEpoch: this.options.createShardEpoch,
          createSessionId: this.options.createSessionId,
          createCursorToken: this.options.createCursorToken,
        })
      },
    })
    return context

    function requireGenesis() {
      if (!activeGenesis) throw new Error("No exact-claim successor genesis writer is active")
      return activeGenesis
    }
  }
}

function signerSource(vault: ElectronReplicaSigningVaultV2): SuccessorGenesisSignerSourceV3 {
  return Object.freeze({
    async open({ binding }: Parameters<SuccessorGenesisSignerSourceV3["open"]>[0]) {
      const opened = await vault.openSigner({
        projectId: binding.core.projectId,
        projectEpoch: binding.core.projectEpoch,
        replicaId: binding.core.initialReplicaId,
        expectedPublicKey: binding.core.ownerPublicKey,
      })
      return opened === "unavailable" ? "missing" : opened
    },
  })
}

function localIncomingAuthority(
  ownerStore: NodeSuccessorLocalOwnerAuthorityStoreV3,
  verifier: CollaborationKernelOptionsV2["signatureVerifier"],
) {
  const resolver: SuccessorIncomingAuthorityProofResolverPortV3 = Object.freeze({
    async resolveLocalOwner({ frame }: Readonly<{ frame: DecodedCausalEditFrameV3 }>) {
      const scope = frame.header.core.scope
      const ownerSchemaDigest: DigestV2 = scope.docKind === "project-index"
        ? PROJECT_INDEX_PROTOCOL_SCHEMA_ARTIFACT_DIGEST_V2
        : CANVAS_PROTOCOL_SCHEMA_ARTIFACT_DIGEST_V2
      const resolved = await ownerStore.resolveExact({
        projectId: scope.projectId,
        projectEpoch: scope.projectEpoch,
        scope,
        ownerSchemaDigest,
        protocolDigest: parseDigestV2(frame.header.core.protocolDigest),
      })
      if (resolved === "missing") return Object.freeze({ status: "pending" as const })
      if (resolved === "rejected") return Object.freeze({ status: "rejected" as const })
      return Object.freeze({
        status: "resolved" as const,
        proof: Object.freeze({
          binding: resolved.binding,
          authorization: resolved.authorization,
          ownerSchemaDigest,
          sharingState: ownerStore,
        }),
      })
    },
    async resolveTeamReplica() { return Object.freeze({ status: "rejected" as const }) },
  })
  return createSelectedIncomingAuthorityVerificationPortV3({ resolver, verifier })
}

function singletonProjectLease(input: Readonly<{
  projectId: string
  projectRoot: string
  collaborationDirectory: string
  runtime: MainProjectCollaborationProductionRuntimeV3
  actorId: ProjectCollaborationRuntimeLeaseV2["localActorId"]
}>) {
  return Object.freeze({
    async acquire(projectId: string): Promise<ProjectCollaborationRuntimeLeaseV2> {
      if (parseProjectIdV2(projectId) !== input.projectId) throw new Error("V3 Project lease crossed Project identity")
      return Object.freeze({
        projectId: input.projectId,
        projectRoot: input.projectRoot,
        collaborationDirectory: input.collaborationDirectory,
        persistence: input.runtime.persistence,
        localActorId: input.actorId,
        release() {},
      })
    },
  })
}
