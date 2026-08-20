import {
  parseDigest,
  parseProjectId,
  replicaActorHeadSetDigest,
  type Digest,
  type ProjectId,
} from "@convax/collaboration"
import {
  installCanvasGenesisProofCarrierVerifierFactory as installImmediatePredecessorCanvasGenesisProofCarrierVerifierFactory,
} from "@convax/canvas/collaboration-migration"
import {
  createImmediatePredecessorCurrentStorePort,
  createImmediatePredecessorProjectMigrationPort,
  type ImmediatePredecessorCurrentGenesisAuthorPort,
  type ImmediatePredecessorCurrentStorePort,
  type ImmediatePredecessorProjectMigrationAuthorityPort,
  type ImmediatePredecessorProjectMigrationPort,
  type ImmediatePredecessorProjectMigrationRuntimePort,
  type NodeReplicaHeadMaterializer,
} from "@convax/project/node"

import type { CanvasGenesisAuthorProviderPort } from "./canvas-document-genesis"
import { createLocalProjectOwnerCanvasGenesisAuthority } from "./local-project-owner-canvas-genesis"
import type {
  ActivatedImmediatePredecessorLocalOwnerMigrationAuthority,
  NodeDurableLocalProjectOwnerAuthority,
  PreparedImmediatePredecessorLocalOwnerMigrationAuthority,
} from "./local-project-owner-authority"

type PredecessorInspection = Awaited<
  ReturnType<ImmediatePredecessorProjectMigrationAuthorityPort["inspectPredecessor"]>
>
type InspectPredecessorInput = Parameters<ImmediatePredecessorProjectMigrationAuthorityPort["inspectPredecessor"]>[0]
type PrepareCurrentInput = Parameters<ImmediatePredecessorProjectMigrationAuthorityPort["prepareCurrent"]>[0]

export interface DesktopImmediatePredecessorTeamStatePort {
  resolve(projectId: ProjectId): Promise<"missing" | "active" | "rejected">
}

export interface DesktopImmediatePredecessorLocalOwnerAuthorityPort {
  inspectImmediatePredecessorMigrationAuthority(
    input: Parameters<NodeDurableLocalProjectOwnerAuthority["inspectImmediatePredecessorMigrationAuthority"]>[0],
  ): ReturnType<NodeDurableLocalProjectOwnerAuthority["inspectImmediatePredecessorMigrationAuthority"]>
  activateImmediatePredecessorMigrationAuthority(
    prepared: PreparedImmediatePredecessorLocalOwnerMigrationAuthority,
    sourceClosureDigest: Digest,
  ): Promise<ActivatedImmediatePredecessorLocalOwnerMigrationAuthority>
}

export interface CreateDesktopImmediatePredecessorProjectMigrationCompositionOptions {
  readonly teamState: DesktopImmediatePredecessorTeamStatePort
  /**
   * A Team predecessor is never reinterpreted as a local-owner Project. When the
   * current Team signer cannot verify and issue the exact migration authority,
   * omission of this port deliberately leaves the predecessor untouched.
   */
  readonly teamAuthority?: ImmediatePredecessorProjectMigrationAuthorityPort
  readonly localOwner: DesktopImmediatePredecessorLocalOwnerAuthorityPort
  readonly currentStore: ImmediatePredecessorCurrentStorePort
  readonly runtime: ImmediatePredecessorProjectMigrationRuntimePort
}

export function createDesktopImmediatePredecessorCurrentStore(input: Readonly<{
  authority: Parameters<typeof createImmediatePredecessorCurrentStorePort>[0]["authority"]
  canvasRuntime: Parameters<typeof createImmediatePredecessorCurrentStorePort>[0]["canvasRuntime"]
  localOwner: DesktopImmediatePredecessorLocalOwnerAuthorityPort & Pick<
    NodeDurableLocalProjectOwnerAuthority,
    "resolveCurrent" | "verifyCheckpointSignature"
  >
  teamState: DesktopImmediatePredecessorTeamStatePort
  teamAuthors?: ImmediatePredecessorCurrentGenesisAuthorPort
}>): ImmediatePredecessorCurrentStorePort {
  const migrationCanvasAuthority = createLocalProjectOwnerCanvasGenesisAuthority({
    authority: input.authority,
    resolveOwner: ({ projectId, projectEpoch }) => input.localOwner.resolveCurrent({ projectId, projectEpoch }),
  })
  // The migration subpath is a separately-built package entry. Its verifier and
  // builder must share that entry's sealed live-capability registry; a verifier
  // minted by the ordinary collaboration entry is structurally identical but
  // deliberately not live in the migration entry.
  const migrationVerifierFactory = installImmediatePredecessorCanvasGenesisProofCarrierVerifierFactory({
    authority: input.authority,
    historicalAuthorVerifier: migrationCanvasAuthority.historicalAuthorVerifier,
  })
  const migrationVerifier = migrationVerifierFactory.createVerifier(input.canvasRuntime)
  if (migrationVerifier.status !== "created") {
    throw new Error(`Canvas migration genesis proof verifier is ${migrationVerifier.code}`)
  }
  return createImmediatePredecessorCurrentStorePort({
    authority: input.authority,
    canvasRuntime: input.canvasRuntime,
    canvasProofVerifier: migrationVerifier.verifier,
    materializer: importedGenesisMaterializer,
    authors: createDesktopImmediatePredecessorCurrentGenesisAuthors({
      ...input,
      localCanvasAuthors: migrationCanvasAuthority.authorProvider,
    }),
  })
}

function createDesktopImmediatePredecessorCurrentGenesisAuthors(input: Readonly<{
  localCanvasAuthors: CanvasGenesisAuthorProviderPort
  localOwner: Pick<NodeDurableLocalProjectOwnerAuthority, "resolveCurrent" | "verifyCheckpointSignature">
  teamState: DesktopImmediatePredecessorTeamStatePort
  teamAuthors?: ImmediatePredecessorCurrentGenesisAuthorPort
}>): ImmediatePredecessorCurrentGenesisAuthorPort {
  return Object.freeze({
    async prepareProjectIndexAuthor(
      request: Parameters<ImmediatePredecessorCurrentGenesisAuthorPort["prepareProjectIndexAuthor"]>[0],
    ) {
      if (request.expectedAuthority.mode === "team-replica") {
        if (await input.teamState.resolve(request.scope.projectId) !== "active") return "rejected"
        return input.teamAuthors?.prepareProjectIndexAuthor(request) ?? "unavailable"
      }
      const owner = await resolveExactLocalOwner(input, request.scope, request.expectedAuthority)
      if (typeof owner === "string") return owner
      return Object.freeze({
        checkpointId: owner.binding.genesisCheckpointId,
        signCheckpointCoreDigest: (coreDigest: Digest) => owner.signer.sign(Buffer.from(parseDigest(coreDigest), "hex")),
      })
    },
    async prepareCanvasAuthor(
      request: Parameters<ImmediatePredecessorCurrentGenesisAuthorPort["prepareCanvasAuthor"]>[0],
    ) {
      if (request.expectedAuthority.mode === "team-replica") {
        if (await input.teamState.resolve(request.scope.projectId) !== "active") return "rejected"
        return input.teamAuthors?.prepareCanvasAuthor(request) ?? "unavailable"
      }
      const owner = await resolveExactLocalOwner(input, request.scope, request.expectedAuthority)
      if (typeof owner === "string") return owner
      const prepared = await input.localCanvasAuthors.prepareAuthor({
        scope: request.scope,
        projectIndexRouteDependencyFrameDigest: request.migrationImportBaseProofDigest,
      })
      if (prepared.status !== "prepared") return prepared.status === "pending" ? "unavailable" : "rejected"
      const author = prepared.author
      return author.authorActorId === request.expectedAuthority.actorId &&
        author.authorMemberId === request.expectedAuthority.memberId &&
        author.authorReplicaId === request.expectedAuthority.replicaId &&
        author.authorAuthorizationDigest === request.expectedAuthority.authorizationDigest &&
        author.authorAuthorityDigest === request.expectedAuthority.authorityDigest &&
        author.authorAuthorityKind === "local-project-owner"
        ? author
        : "rejected"
    },
    async verifyProjectIndexCheckpoint(
      request: Parameters<ImmediatePredecessorCurrentGenesisAuthorPort["verifyProjectIndexCheckpoint"]>[0],
    ) {
      if (request.expectedAuthority.mode === "team-replica") {
        if (await input.teamState.resolve(request.checkpoint.core.scope.projectId) !== "active") return false
        return input.teamAuthors?.verifyProjectIndexCheckpoint(request) ?? false
      }
      const owner = await resolveExactLocalOwner(input, request.checkpoint.core.scope, request.expectedAuthority)
      if (typeof owner === "string") return false
      const core = request.checkpoint.core
      return core.authorActorId === owner.binding.actorId &&
        core.authorMemberId === owner.binding.memberId &&
        core.authorReplicaId === owner.binding.replicaId &&
        core.authorAuthorizationDigest === owner.binding.bindingDigest &&
        core.validationArtifactSetDigest === owner.binding.validationArtifactSetDigest &&
        input.localOwner.verifyCheckpointSignature(
          owner.binding,
          request.checkpoint.coreDigest,
          request.checkpoint.replicaSignature,
        )
    },
  })
}

async function resolveExactLocalOwner(
  input: Pick<Parameters<typeof createDesktopImmediatePredecessorCurrentGenesisAuthors>[0], "localOwner" | "teamState">,
  scope: Parameters<NodeDurableLocalProjectOwnerAuthority["resolveCurrent"]>[0] & { readonly projectId: ProjectId },
  expected: Parameters<ImmediatePredecessorCurrentGenesisAuthorPort["prepareProjectIndexAuthor"]>[0]["expectedAuthority"],
) {
  if (await input.teamState.resolve(scope.projectId) !== "missing") return "rejected" as const
  const owner = await input.localOwner.resolveCurrent({
    projectId: scope.projectId,
    projectEpoch: scope.projectEpoch,
  })
  if (owner === "missing") return "unavailable" as const
  if (owner === "rejected") return "rejected" as const
  const binding = owner.binding
  return expected.mode === "local-project-owner" &&
    binding.actorId === expected.actorId &&
    binding.memberId === expected.memberId &&
    binding.replicaId === expected.replicaId &&
    binding.bindingDigest === expected.authorizationDigest &&
    binding.bindingDigest === expected.authorityDigest
    ? owner
    : "rejected" as const
}

const importedGenesisMaterializer: NodeReplicaHeadMaterializer = Object.freeze({
  async inspectFrame() {
    throw new Error("Imported genesis verification does not admit causal frames")
  },
  async applyAcceptedFrame() {
    throw new Error("Imported genesis verification does not apply causal frames")
  },
  actorHeadsDigest: replicaActorHeadSetDigest,
})

/**
 * Desktop-only composition of Project's sealed one-shot migration gate. Project
 * owns decoding, semantic rebuilding, staging, cutover and cold verification;
 * Desktop contributes only the native local/Team authority and runtime adapters.
 */
export function createDesktopImmediatePredecessorProjectMigrationComposition(
  options: CreateDesktopImmediatePredecessorProjectMigrationCompositionOptions,
): ImmediatePredecessorProjectMigrationPort {
  return createImmediatePredecessorProjectMigrationPort({
    authority: createDesktopImmediatePredecessorProjectMigrationAuthority(options),
    currentStore: options.currentStore,
    runtime: options.runtime,
  })
}

export function createDesktopImmediatePredecessorProjectMigrationAuthority(
  options: Pick<
    CreateDesktopImmediatePredecessorProjectMigrationCompositionOptions,
    "teamState" | "teamAuthority" | "localOwner"
  >,
): ImmediatePredecessorProjectMigrationAuthorityPort {
  const localPreparations = new WeakMap<object, PreparedImmediatePredecessorLocalOwnerMigrationAuthority>()
  const teamPreparations = new WeakSet<object>()

  return Object.freeze({
    async inspectPredecessor(input: InspectPredecessorInput): Promise<PredecessorInspection> {
      const projectId = parseProjectId(input.projectId)
      const teamState = await options.teamState.resolve(projectId)
      if (teamState === "rejected") return Object.freeze({ status: "rejected" as const })
      if (teamState === "active") {
        if (!options.teamAuthority) return Object.freeze({ status: "unavailable" as const })
        const inspected = await options.teamAuthority.inspectPredecessor(input)
        if (inspected.status !== "verified") return inspected
        if (inspected.mode !== "team-replica") return Object.freeze({ status: "rejected" as const })
        teamPreparations.add(inspected)
        return inspected
      }

      const prepared = await options.localOwner.inspectImmediatePredecessorMigrationAuthority({
        projectId,
        projectRoot: input.projectRoot,
        projectEpoch: input.predecessorManifest.projectIndexScope.projectEpoch,
        projectIndexShardEpoch: input.predecessorManifest.projectIndexScope.shardEpoch,
        initializationAuthorityDigest: input.predecessorManifest.initializationAuthorityDigest,
      })
      if (prepared === "missing") return Object.freeze({ status: "unavailable" as const })
      if (prepared === "rejected") return Object.freeze({ status: "rejected" as const })
      const inspected = Object.freeze({
        status: "verified" as const,
        mode: "local-project-owner" as const,
        predecessorLocalActorId: prepared.predecessor.binding.actorId,
        predecessorReplicaId: prepared.predecessor.binding.replicaId,
        predecessorSignatures: prepared.predecessorSignatures,
      })
      localPreparations.set(inspected, prepared)
      return inspected
    },

    async prepareCurrent(input: PrepareCurrentInput) {
      const projectId = parseProjectId(input.projectId)
      const teamState = await options.teamState.resolve(projectId)
      if (teamState === "rejected") return Object.freeze({ status: "rejected" as const })
      if (input.predecessor.mode === "team-replica") {
        if (
          teamState !== "active" ||
          !options.teamAuthority ||
          !teamPreparations.has(input.predecessor)
        ) return Object.freeze({ status: "rejected" as const })
        const current = await options.teamAuthority.prepareCurrent(input)
        return current.status === "authorized" && current.mode !== "team-replica"
          ? Object.freeze({ status: "rejected" as const })
          : current
      }
      if (teamState !== "missing") return Object.freeze({ status: "rejected" as const })

      const prepared = localPreparations.get(input.predecessor)
      if (!prepared || input.predecessor.mode !== "local-project-owner") {
        return Object.freeze({ status: "rejected" as const })
      }
      const activated = await options.localOwner.activateImmediatePredecessorMigrationAuthority(
        prepared,
        parseDigest(input.sourceClosureDigest),
      )
      return localCurrentAuthority(activated)
    },
  })
}

function localCurrentAuthority(
  activated: ActivatedImmediatePredecessorLocalOwnerMigrationAuthority,
): Extract<Awaited<ReturnType<ImmediatePredecessorProjectMigrationAuthorityPort["prepareCurrent"]>>, {
  readonly status: "authorized"
}> {
  const binding = activated.currentOwner.binding
  return Object.freeze({
    status: "authorized" as const,
    mode: "local-project-owner" as const,
    actorId: binding.actorId,
    memberId: binding.memberId,
    replicaId: binding.replicaId,
    authorizationDigest: binding.bindingDigest,
    authorityDigest: binding.bindingDigest,
    migrationOperationId: activated.migrationOperationId,
  })
}
