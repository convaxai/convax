import { createHash } from "node:crypto"
import path from "node:path"
import {
  encodeRestrictedJcs,
  parseDigest,
  parseId128,
  parseProjectId,
  type Id128,
  type CurrentProtocolAuthority,
} from "@convax/collaboration"
import { PROJECT_INDEX_PROTOCOL_SCHEMA_ARTIFACT_DIGEST_V2 } from "@convax/project"
import {
  parseProjectResetConfirmationV2,
  projectResetConfirmationCoreDigestV2,
  projectResetConfirmationSignatureMessageV2,
  type ProjectResetConfirmationCoreV2,
  type ProjectResetConfirmationV2,
} from "@convax/project/collaboration-protocol"
import {
  derivePortableProjectResetExecutionFingerprint,
  readProjectNativeStoreManifestV2,
  readProjectResetRecordsV2,
  writeProjectResetRecordsV2,
  type PortableProjectResetPlanV1,
  type ProjectResetAuthorityPortV1,
  type ProjectResetManifestStateV2,
  type ProjectResetManifestV2,
  type ProjectResetPreparedAuthorityV1,
} from "@convax/project/node"

import {
  initializeLocalOwnerProjectIndexNativeStoreV2,
  verifyPristineLocalOwnerProjectIndexNativeStoreV2,
} from "./main-project-index-runtime-registry"
import {
  type NodeDurableLocalProjectOwnerAuthorityV2,
  type ResolvedLocalProjectOwnerAuthorityV2,
} from "./local-project-owner-authority"

export class TeamProjectResetUnavailableErrorV2 extends Error {
  readonly code = "team-project-reset-unavailable" as const

  constructor(options?: ErrorOptions) {
    super("Team Project reset requires the unavailable control-plane epoch rollover authority", options)
    this.name = "TeamProjectResetUnavailableErrorV2"
  }
}

/**
 * Desktop edge for the frozen unteamed reset branch. It supplies only the
 * pre-bound OS-vault principal and native composition; Project owns the reset
 * record codec, tree swap, and empty ProjectIndex schema.
 */
export class LocalProjectResetAuthorityV2 implements ProjectResetAuthorityPortV1 {
  constructor(
    private readonly options: {
      readonly authority: CurrentProtocolAuthority
      readonly owners: NodeDurableLocalProjectOwnerAuthorityV2
    },
  ) {}

  async inspectReset(input: { readonly plan: PortableProjectResetPlanV1; readonly signal?: AbortSignal }): Promise<
    | Readonly<{ status: "eligible" }>
    | Readonly<{
        reason: "team-epoch-rollover-required"
        status: "unavailable"
      }>
  > {
    try {
      await this.resolveResetOwner(input.plan, false, input.signal)
      return Object.freeze({ status: "eligible" as const })
    } catch (error) {
      if (error instanceof TeamProjectResetUnavailableErrorV2) {
        return Object.freeze({ reason: "team-epoch-rollover-required" as const, status: "unavailable" as const })
      }
      throw error
    }
  }

  async prepareReset(input: {
    readonly plan: PortableProjectResetPlanV1
    readonly signal?: AbortSignal
  }): Promise<ProjectResetPreparedAuthorityV1> {
    throwIfAborted(input.signal)
    const owner = await this.resolveResetOwner(input.plan, true, input.signal)
    if (!owner) throw new Error("Local Project reset owner was not prepared")
    const confirmation = await this.createConfirmation(input.plan, owner)
    const expectedFingerprint = derivePortableProjectResetExecutionFingerprint({
      authorizationKind: "local-project-owner",
      confirmationToken: input.plan.token,
      nextProjectEpoch: owner.binding.projectEpoch,
      originalTreeDigest: input.plan.originalTreeDigest,
      privateDeletionSetDigest: input.plan.privateDeletionSetDigest,
      projectId: input.plan.projectId,
      unsupportedInventoryDigest: input.plan.unsupportedInventoryDigest,
    })
    const expected = Object.freeze({
      plan: input.plan,
      owner,
      confirmation,
      executionFingerprint: expectedFingerprint,
    })

    return Object.freeze({
      authorizationEvidence: confirmation,
      authorizationKind: "local-project-owner" as const,
      nextProjectEpoch: owner.binding.projectEpoch,
      stageGenesis: async (stageInput: Parameters<ProjectResetPreparedAuthorityV1["stageGenesis"]>[0]) => {
        throwIfAborted(stageInput.signal)
        assertStageInput(expected, stageInput)
        const collaborationDirectory = path.join(stageInput.stagedConvaxDirectory, "collaboration")
        await initializeLocalOwnerProjectIndexNativeStoreV2({
          authority: this.options.authority,
          collaborationDirectory,
          owner,
          verifyCheckpointSignature: (binding, coreDigest, signature) =>
            this.options.owners.verifyCheckpointSignature(binding, coreDigest, signature),
        })
        const nativeManifest = await this.readNativeManifest(collaborationDirectory)
        await writeProjectResetRecordsV2(collaborationDirectory, {
          format: "convax.project-reset-records/2",
          confirmation,
          manifest: createResetManifest(expected, nativeManifest, "reset-staged"),
        })
      },
      verifier: Object.freeze({
        authorizeStagedReset: async (
          verifyInput: Parameters<ProjectResetPreparedAuthorityV1["verifier"]["authorizeStagedReset"]>[0],
        ) => {
          if (
            !matchesVerificationInput(expected, verifyInput) ||
            verifyInput.authorizationKind !== "local-project-owner"
          ) {
            return "rejected"
          }
          let evidence: ProjectResetConfirmationV2
          try {
            evidence = parseProjectResetConfirmationV2(verifyInput.authorizationEvidence)
          } catch {
            return "rejected"
          }
          if (!sameExactValue(evidence, confirmation) || !(await this.verifyConfirmation(owner, evidence))) {
            return "rejected"
          }
          return (await this.verifyAndAdvance(
            expected,
            path.join(verifyInput.stagedConvaxDirectory, "collaboration"),
            "reset-staged",
            "reset-authorized",
          ))
            ? "verified"
            : "rejected"
        },
        verifyStagedGenesis: async (
          verifyInput: Parameters<ProjectResetPreparedAuthorityV1["verifier"]["verifyStagedGenesis"]>[0],
        ) => {
          if (!matchesVerificationInput(expected, verifyInput)) return false
          return this.verifyAndAdvance(
            expected,
            path.join(verifyInput.stagedConvaxDirectory, "collaboration"),
            "reset-authorized",
            "reset-publishing",
          )
        },
        verifyPublishedGenesis: async (
          verifyInput: Parameters<ProjectResetPreparedAuthorityV1["verifier"]["verifyPublishedGenesis"]>[0],
        ) => {
          if (!matchesVerificationInput(expected, verifyInput)) return false
          return this.verifyAndAdvance(
            expected,
            path.join(verifyInput.publishedConvaxDirectory, "collaboration"),
            "reset-publishing",
            "reset-published",
          )
        },
      }),
    })
  }

  private async resolveResetOwner(
    plan: PortableProjectResetPlanV1,
    createIfMissing: boolean,
    signal?: AbortSignal,
  ): Promise<ResolvedLocalProjectOwnerAuthorityV2 | undefined> {
    assertNoTeamNamespaces(plan)
    throwIfAborted(signal)
    const projectId = parseProjectId(plan.projectId)
    const hasCollaborationStore = plan.preview.some(
      ({ path: candidate }) => candidate === ".convax/collaboration" || candidate.startsWith(".convax/collaboration/"),
    )
    if (!hasCollaborationStore) {
      return createIfMissing
        ? this.options.owners.ensureForDurableProject({ projectId, projectRoot: plan.projectRoot })
        : undefined
    }

    try {
      const collaborationDirectory = path.join(plan.projectRoot, ".convax", "collaboration")
      const manifest = await this.readNativeManifest(collaborationDirectory)
      if (manifest.projectIndexScope.projectId !== projectId) throw new Error("ProjectIndex manifest crossed Project")
      const owner = await this.options.owners.resolveExact({
        projectId,
        projectEpoch: manifest.projectIndexScope.projectEpoch,
        initializationAuthorityDigest: manifest.initializationAuthorityDigest,
      })
      if (
        owner === "missing" ||
        owner === "rejected" ||
        owner.binding.projectIndexShardEpoch !== manifest.projectIndexScope.shardEpoch
      ) {
        throw new Error("ProjectIndex bootstrap does not resolve to the exact local owner")
      }
      await verifyPristineLocalOwnerProjectIndexNativeStoreV2({
        authority: this.options.authority,
        collaborationDirectory,
        owner,
        verifyCheckpointSignature: (binding, coreDigest, signature) =>
          this.options.owners.verifyCheckpointSignature(binding, coreDigest, signature),
      })
      throwIfAborted(signal)
      return owner
    } catch (error) {
      if (signal?.aborted) throw signal.reason ?? error
      if (error instanceof TeamProjectResetUnavailableErrorV2) throw error
      throw new TeamProjectResetUnavailableErrorV2({ cause: error })
    }
  }

  private async createConfirmation(
    plan: PortableProjectResetPlanV1,
    owner: ResolvedLocalProjectOwnerAuthorityV2,
  ): Promise<ProjectResetConfirmationV2> {
    const resetId = derivedId128("convax.local-project-reset-id/2", {
      projectId: plan.projectId,
      observedOldPrivateTreeDigest: plan.originalTreeDigest,
      unsupportedInventoryDigest: plan.unsupportedInventoryDigest,
      privateDeletionSetDigest: plan.privateDeletionSetDigest,
      localProjectBindingDigest: owner.binding.bindingDigest,
    })
    const confirmationId = derivedId128("convax.local-project-reset-confirmation-id/2", {
      resetId,
      localProjectBindingDigest: owner.binding.bindingDigest,
    })
    const core: ProjectResetConfirmationCoreV2 = Object.freeze({
      format: "convax.project-reset-confirmation-core/2",
      resetId,
      confirmationId,
      projectId: owner.binding.projectId,
      oldProjectEpoch: null,
      reason: "unsupported-portable-version",
      observedOldPrivateTreeDigest: parseDigest(plan.originalTreeDigest),
      unsupportedInventoryDigest: parseDigest(plan.unsupportedInventoryDigest),
      privateDeletionSetDigest: parseDigest(plan.privateDeletionSetDigest),
      stableProjectIdPreserved: true,
      ordinaryProjectFilesPreserved: true,
      deletionStatement: "delete-exact-displayed-private-project-state",
      requestedProtocolDigest: this.options.authority.protocolDigest,
      requestedSchemaDigest: PROJECT_INDEX_PROTOCOL_SCHEMA_ARTIFACT_DIGEST_V2,
      requestedUriProtocolDigest: this.options.authority.protocolSchemaBundle.core.uriProtocolDigest,
      confirmationPrincipal: Object.freeze({
        kind: "local-project-owner",
        localProjectBindingDigest: owner.binding.bindingDigest,
        localConfirmationKeyId: owner.binding.localConfirmationKeyId,
      }),
      protocolDigest: this.options.authority.protocolDigest,
    })
    const coreDigest = projectResetConfirmationCoreDigestV2(core)
    return parseProjectResetConfirmationV2({
      format: "convax.project-reset-confirmation/2",
      core,
      coreDigest,
      confirmationSignature: await owner.signer.sign(projectResetConfirmationSignatureMessageV2(coreDigest)),
    })
  }

  private async verifyConfirmation(
    owner: ResolvedLocalProjectOwnerAuthorityV2,
    confirmation: ProjectResetConfirmationV2,
  ): Promise<boolean> {
    return this.options.owners.verifySignature(
      owner.binding,
      projectResetConfirmationSignatureMessageV2(confirmation.coreDigest),
      confirmation.confirmationSignature,
    )
  }

  private readNativeManifest(collaborationDirectory: string) {
    return readProjectNativeStoreManifestV2(collaborationDirectory, {
      protocolDigest: this.options.authority.protocolDigest,
      schemaDigest: PROJECT_INDEX_PROTOCOL_SCHEMA_ARTIFACT_DIGEST_V2,
      uriProtocolDigest: this.options.authority.protocolSchemaBundle.core.uriProtocolDigest,
    })
  }

  private async verifyAndAdvance(
    expected: ResetExpected,
    collaborationDirectory: string,
    currentState: ProjectResetManifestStateV2,
    nextState: ProjectResetManifestStateV2,
  ): Promise<boolean> {
    try {
      const [nativeManifest, records] = await Promise.all([
        this.readNativeManifest(collaborationDirectory),
        readProjectResetRecordsV2(collaborationDirectory),
      ])
      if (
        records.manifest.state !== currentState ||
        !sameExactValue(records.confirmation, expected.confirmation) ||
        !(await this.verifyConfirmation(expected.owner, records.confirmation)) ||
        !matchesNativeManifest(expected, records.manifest, nativeManifest)
      )
        return false
      await writeProjectResetRecordsV2(collaborationDirectory, {
        format: "convax.project-reset-records/2",
        confirmation: records.confirmation,
        manifest: Object.freeze({ ...records.manifest, state: nextState }),
      })
      return true
    } catch {
      return false
    }
  }
}

type ResetExpected = Readonly<{
  plan: PortableProjectResetPlanV1
  owner: ResolvedLocalProjectOwnerAuthorityV2
  confirmation: ProjectResetConfirmationV2
  executionFingerprint: string
}>

type NativeManifest = Awaited<ReturnType<typeof readProjectNativeStoreManifestV2>>

function createResetManifest(
  expected: ResetExpected,
  native: NativeManifest,
  state: ProjectResetManifestStateV2,
): ProjectResetManifestV2 {
  return Object.freeze({
    format: "convax.project-reset-manifest/2",
    resetId: expected.confirmation.core.resetId,
    projectId: expected.owner.binding.projectId,
    oldProjectEpoch: null,
    newProjectEpoch: expected.owner.binding.projectEpoch,
    newMembershipEpoch: null,
    newProjectIndexShardEpoch: expected.owner.binding.projectIndexShardEpoch,
    reason: "unsupported-portable-version",
    observedOldPrivateTreeDigest: parseDigest(expected.plan.originalTreeDigest),
    unsupportedInventoryDigest: parseDigest(expected.plan.unsupportedInventoryDigest),
    privateDeletionSetDigest: parseDigest(expected.plan.privateDeletionSetDigest),
    requestedProtocolDigest: native.protocolDigest,
    requestedSchemaDigest: native.schemaDigest,
    requestedUriProtocolDigest: native.uriProtocolDigest,
    emptyProjectIndexCheckpointDigest: native.emptyProjectIndexCheckpointObjectDigest,
    emptyProjectIndexFullUpdateDigest: native.emptyProjectIndexFullUpdateDigest,
    emptyProjectIndexStateVectorDigest: native.emptyProjectIndexStateVectorDigest,
    emptyProjectIndexCanonicalStateDigest: native.emptyProjectIndexCanonicalStateDigest,
    projectResetConfirmationCoreDigest: expected.confirmation.coreDigest,
    projectResetApprovalCoreDigest: null,
    teamEpochRolloverRequestDigest: null,
    emptyProjectIndexGenesisAttestationCoreDigest: null,
    teamEpochRolloverReceiptCoreDigest: null,
    state,
  })
}

function matchesNativeManifest(
  expected: ResetExpected,
  reset: ProjectResetManifestV2,
  native: NativeManifest,
): boolean {
  return (
    reset.projectId === native.projectIndexScope.projectId &&
    reset.newProjectEpoch === native.projectIndexScope.projectEpoch &&
    reset.newProjectIndexShardEpoch === native.projectIndexScope.shardEpoch &&
    reset.newProjectEpoch === expected.owner.binding.projectEpoch &&
    native.initializationAuthorityDigest === expected.owner.binding.bindingDigest &&
    reset.requestedProtocolDigest === native.protocolDigest &&
    reset.requestedSchemaDigest === native.schemaDigest &&
    reset.requestedUriProtocolDigest === native.uriProtocolDigest &&
    reset.emptyProjectIndexCheckpointDigest === native.emptyProjectIndexCheckpointObjectDigest &&
    reset.emptyProjectIndexFullUpdateDigest === native.emptyProjectIndexFullUpdateDigest &&
    reset.emptyProjectIndexStateVectorDigest === native.emptyProjectIndexStateVectorDigest &&
    reset.emptyProjectIndexCanonicalStateDigest === native.emptyProjectIndexCanonicalStateDigest
  )
}

function assertNoTeamNamespaces(plan: PortableProjectResetPlanV1): void {
  // This branch relies on the cutover invariant that legacy Convax releases
  // persisted every team/control identity under one of these exact private
  // namespaces. It is deliberately not a heuristic for arbitrary corruption:
  // any such namespace makes local authority unavailable.
  const teamNamespaces = [
    ".convax/team",
    ".convax/membership",
    ".convax/member-credentials",
    ".convax/service-registry",
    ".convax/replica-enrollment",
    ".convax/project-reset",
  ] as const
  const hasTeamEvidence = plan.preview.some(({ path: candidate }) =>
    teamNamespaces.some((namespace) => candidate === namespace || candidate.startsWith(`${namespace}/`)),
  )
  if (hasTeamEvidence) throw new TeamProjectResetUnavailableErrorV2()
}

function assertStageInput(
  expected: ResetExpected,
  input: {
    readonly nextProjectEpoch: string
    readonly projectId: string
  },
): void {
  if (input.projectId !== expected.plan.projectId || input.nextProjectEpoch !== expected.owner.binding.projectEpoch) {
    throw new Error("Project reset staging crossed the prepared local authority")
  }
}

function matchesVerificationInput(
  expected: ResetExpected,
  input: {
    readonly executionFingerprint: string
    readonly nextProjectEpoch: string
    readonly originalTreeDigest: string
    readonly privateDeletionSetDigest: string
    readonly projectId: string
    readonly unsupportedInventoryDigest: string
  },
): boolean {
  return (
    input.executionFingerprint === expected.executionFingerprint &&
    input.nextProjectEpoch === expected.owner.binding.projectEpoch &&
    input.projectId === expected.plan.projectId &&
    input.originalTreeDigest === expected.plan.originalTreeDigest &&
    input.privateDeletionSetDigest === expected.plan.privateDeletionSetDigest &&
    input.unsupportedInventoryDigest === expected.plan.unsupportedInventoryDigest
  )
}

function derivedId128(domain: string, value: unknown): Id128 {
  const digest = createHash("sha256").update(`${domain}\0`, "utf8").update(encodeRestrictedJcs(value)).digest()
  return parseId128(digest.subarray(0, 16).toString("base64url"))
}

function sameExactValue(left: unknown, right: unknown): boolean {
  const leftBytes = encodeRestrictedJcs(left)
  const rightBytes = encodeRestrictedJcs(right)
  return leftBytes.byteLength === rightBytes.byteLength && leftBytes.every((byte, index) => byte === rightBytes[index])
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw signal.reason ?? new Error("Project reset was cancelled")
}
