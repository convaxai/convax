import { createHash } from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"
import {
  encodeRestrictedJcs,
  parseDigest,
  parseId128,
  parseProjectId,
  type Id128,
  type CurrentProtocolAuthority,
} from "@convax/collaboration"
import { PROJECT_INDEX_PROTOCOL_SCHEMA_ARTIFACT_DIGEST } from "@convax/project"
import {
  parseProjectResetConfirmation,
  projectResetConfirmationCoreDigest,
  projectResetConfirmationSignatureMessage,
  type ProjectResetConfirmationCore,
  type ProjectResetConfirmation,
} from "@convax/project/collaboration-protocol"
import {
  derivePortableProjectResetExecutionFingerprint,
  readProjectNativeStoreManifest,
  readProjectResetRecords,
  writeProjectResetRecords,
  type PortableProjectResetPlan,
  type ProjectResetAuthorityPort,
  type ProjectResetManifestState,
  type ProjectResetManifest,
  type ProjectResetPreparedAuthority,
} from "@convax/project/node"

import {
  initializeLocalOwnerProjectIndexNativeStore,
  verifyPristineLocalOwnerProjectIndexNativeStore,
} from "./main-project-index-runtime-registry"
import {
  type NodeDurableLocalProjectOwnerAuthority,
  type PreparedLocalProjectOwnerReset,
  type ResolvedLocalProjectOwnerAuthority,
} from "./local-project-owner-authority"
import type { NodeDurableTeamAuthorityStore } from "./durable-team-authority-store"

export class TeamProjectResetUnavailableError extends Error {
  readonly code = "team-project-reset-unavailable" as const

  constructor(options?: ErrorOptions) {
    super("Team Project reset requires the unavailable control-plane epoch rollover authority", options)
    this.name = "TeamProjectResetUnavailableError"
  }
}

/**
 * Desktop edge for the frozen unteamed reset branch. It supplies only the
 * pre-bound OS-vault principal and native composition; Project owns the reset
 * record codec, tree swap, and empty ProjectIndex schema.
 */
export class LocalProjectResetAuthority implements ProjectResetAuthorityPort {
  constructor(
    private readonly options: {
      readonly authority: CurrentProtocolAuthority
      readonly owners: NodeDurableLocalProjectOwnerAuthority
      readonly teams: Pick<NodeDurableTeamAuthorityStore, "open">
    },
  ) {}

  async inspectReset(input: { readonly plan: PortableProjectResetPlan; readonly signal?: AbortSignal }): Promise<
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
      if (error instanceof TeamProjectResetUnavailableError) {
        return Object.freeze({ reason: "team-epoch-rollover-required" as const, status: "unavailable" as const })
      }
      throw error
    }
  }

  async prepareReset(input: {
    readonly plan: PortableProjectResetPlan
    readonly signal?: AbortSignal
  }): Promise<ProjectResetPreparedAuthority> {
    throwIfAborted(input.signal)
    const resetOwner = await this.resolveResetOwner(input.plan, true, input.signal)
    if (!resetOwner) throw new Error("Local Project reset owner was not prepared")
    const { owner, preparedReset } = resetOwner
    const confirmation = await this.createConfirmation(input.plan, resetOwner)
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
      resetOwner,
      confirmation,
      executionFingerprint: expectedFingerprint,
    })

    return Object.freeze({
      authorizationEvidence: confirmation,
      authorizationKind: "local-project-owner" as const,
      nextProjectEpoch: owner.binding.projectEpoch,
      stageGenesis: async (stageInput: Parameters<ProjectResetPreparedAuthority["stageGenesis"]>[0]) => {
        throwIfAborted(stageInput.signal)
        assertStageInput(expected, stageInput)
        const collaborationDirectory = path.join(stageInput.stagedConvaxDirectory, "collaboration")
        await initializeLocalOwnerProjectIndexNativeStore({
          authority: this.options.authority,
          collaborationDirectory,
          owner,
          verifyCheckpointSignature: (binding, coreDigest, signature) =>
            preparedReset
              ? this.options.owners.verifyPreparedCheckpointSignature(preparedReset, coreDigest, signature)
              : this.options.owners.verifyCheckpointSignature(binding, coreDigest, signature),
        })
        const nativeManifest = await this.readNativeManifest(collaborationDirectory)
        await writeProjectResetRecords(collaborationDirectory, {
          format: "convax.project-reset-records",
          confirmation,
          manifest: createResetManifest(expected, nativeManifest, "reset-staged"),
        })
      },
      verifier: Object.freeze({
        authorizeStagedReset: async (
          verifyInput: Parameters<ProjectResetPreparedAuthority["verifier"]["authorizeStagedReset"]>[0],
        ) => {
          if (
            !matchesVerificationInput(expected, verifyInput) ||
            verifyInput.authorizationKind !== "local-project-owner"
          ) {
            return "rejected"
          }
          let evidence: ProjectResetConfirmation
          try {
            evidence = parseProjectResetConfirmation(verifyInput.authorizationEvidence)
          } catch {
            return "rejected"
          }
          if (!sameExactValue(evidence, confirmation) || !(await this.verifyConfirmation(resetOwner, evidence))) {
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
          verifyInput: Parameters<ProjectResetPreparedAuthority["verifier"]["verifyStagedGenesis"]>[0],
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
          verifyInput: Parameters<ProjectResetPreparedAuthority["verifier"]["verifyPublishedGenesis"]>[0],
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
      ...(preparedReset
        ? {
            finalizePublishedReset: async () => {
              await this.options.owners.activatePreparedReset(preparedReset)
            },
          }
        : {}),
    })
  }

  private async resolveResetOwner(
    plan: PortableProjectResetPlan,
    createIfMissing: boolean,
    signal?: AbortSignal,
  ): Promise<ResetOwnerAuthority | undefined> {
    assertNoTeamNamespaces(plan)
    throwIfAborted(signal)
    const projectId = parseProjectId(plan.projectId)
    if (await hasRetiredLocalProtocolMarkers(plan)) {
      const team = await this.options.teams.open(projectId)
      if (team !== "missing") throw new TeamProjectResetUnavailableError()
      throwIfAborted(signal)
      if (!createIfMissing) return undefined
      const preparedReset = await this.options.owners.prepareResetForDurableProject({
        projectId,
        projectRoot: plan.projectRoot,
        resetId: plan.token,
      })
      return Object.freeze({ owner: preparedReset.owner, preparedReset })
    }
    const hasCollaborationStore = plan.preview.some(
      ({ path: candidate }) => candidate === ".convax/collaboration" || candidate.startsWith(".convax/collaboration/"),
    )
    if (!hasCollaborationStore) {
      return createIfMissing
        ? Object.freeze({
            owner: await this.options.owners.ensureForDurableProject({ projectId, projectRoot: plan.projectRoot }),
          })
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
      await verifyPristineLocalOwnerProjectIndexNativeStore({
        authority: this.options.authority,
        collaborationDirectory,
        owner,
        verifyCheckpointSignature: (binding, coreDigest, signature) =>
          this.options.owners.verifyCheckpointSignature(binding, coreDigest, signature),
      })
      throwIfAborted(signal)
      return Object.freeze({ owner })
    } catch (error) {
      if (signal?.aborted) throw signal.reason ?? error
      if (error instanceof TeamProjectResetUnavailableError) throw error
      throw new TeamProjectResetUnavailableError({ cause: error })
    }
  }

  private async createConfirmation(
    plan: PortableProjectResetPlan,
    resetOwner: ResetOwnerAuthority,
  ): Promise<ProjectResetConfirmation> {
    const { owner } = resetOwner
    const resetId = derivedId128("convax.local-project-reset-id", {
      projectId: plan.projectId,
      observedOldPrivateTreeDigest: plan.originalTreeDigest,
      unsupportedInventoryDigest: plan.unsupportedInventoryDigest,
      privateDeletionSetDigest: plan.privateDeletionSetDigest,
      localProjectBindingDigest: owner.binding.bindingDigest,
    })
    const confirmationId = derivedId128("convax.local-project-reset-confirmation-id", {
      resetId,
      localProjectBindingDigest: owner.binding.bindingDigest,
    })
    const core: ProjectResetConfirmationCore = Object.freeze({
      format: "convax.project-reset-confirmation-core",
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
      requestedSchemaDigest: PROJECT_INDEX_PROTOCOL_SCHEMA_ARTIFACT_DIGEST,
      requestedUriProtocolDigest: this.options.authority.protocolSchemaBundle.core.uriProtocolDigest,
      confirmationPrincipal: Object.freeze({
        kind: "local-project-owner",
        localProjectBindingDigest: owner.binding.bindingDigest,
        localConfirmationKeyId: owner.binding.localConfirmationKeyId,
      }),
      protocolDigest: this.options.authority.protocolDigest,
    })
    const coreDigest = projectResetConfirmationCoreDigest(core)
    return parseProjectResetConfirmation({
      format: "convax.project-reset-confirmation",
      core,
      coreDigest,
      confirmationSignature: await owner.signer.sign(projectResetConfirmationSignatureMessage(coreDigest)),
    })
  }

  private async verifyConfirmation(
    resetOwner: ResetOwnerAuthority,
    confirmation: ProjectResetConfirmation,
  ): Promise<boolean> {
    const message = projectResetConfirmationSignatureMessage(confirmation.coreDigest)
    return resetOwner.preparedReset
      ? this.options.owners.verifyPreparedSignature(
          resetOwner.preparedReset,
          message,
          confirmation.confirmationSignature,
        )
      : this.options.owners.verifySignature(
          resetOwner.owner.binding,
          message,
          confirmation.confirmationSignature,
        )
  }

  private readNativeManifest(collaborationDirectory: string) {
    return readProjectNativeStoreManifest(collaborationDirectory, {
      protocolDigest: this.options.authority.protocolDigest,
      schemaDigest: PROJECT_INDEX_PROTOCOL_SCHEMA_ARTIFACT_DIGEST,
      uriProtocolDigest: this.options.authority.protocolSchemaBundle.core.uriProtocolDigest,
    })
  }

  private async verifyAndAdvance(
    expected: ResetExpected,
    collaborationDirectory: string,
    currentState: ProjectResetManifestState,
    nextState: ProjectResetManifestState,
  ): Promise<boolean> {
    try {
      const [nativeManifest, records] = await Promise.all([
        this.readNativeManifest(collaborationDirectory),
        readProjectResetRecords(collaborationDirectory),
      ])
      if (
        records.manifest.state !== currentState ||
        !sameExactValue(records.confirmation, expected.confirmation) ||
        !(await this.verifyConfirmation(expected.resetOwner, records.confirmation)) ||
        !matchesNativeManifest(expected, records.manifest, nativeManifest)
      )
        return false
      await writeProjectResetRecords(collaborationDirectory, {
        format: "convax.project-reset-records",
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
  plan: PortableProjectResetPlan
  owner: ResolvedLocalProjectOwnerAuthority
  resetOwner: ResetOwnerAuthority
  confirmation: ProjectResetConfirmation
  executionFingerprint: string
}>

type ResetOwnerAuthority = Readonly<{
  owner: ResolvedLocalProjectOwnerAuthority
  preparedReset?: PreparedLocalProjectOwnerReset
}>

type NativeManifest = Awaited<ReturnType<typeof readProjectNativeStoreManifest>>

function createResetManifest(
  expected: ResetExpected,
  native: NativeManifest,
  state: ProjectResetManifestState,
): ProjectResetManifest {
  return Object.freeze({
    format: "convax.project-reset-manifest",
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
  reset: ProjectResetManifest,
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

function assertNoTeamNamespaces(plan: PortableProjectResetPlan): void {
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
    ".convax/sharing-handoff-v3.jcs",
  ] as const
  const hasTeamEvidence = plan.preview.some(({ path: candidate }) =>
    teamNamespaces.some((namespace) => candidate === namespace || candidate.startsWith(`${namespace}/`)),
  )
  if (hasTeamEvidence) throw new TeamProjectResetUnavailableError()
}

async function hasRetiredLocalProtocolMarkers(plan: PortableProjectResetPlan): Promise<boolean> {
  const expected = [
    ".convax/local-owner-authority-v3.jcs",
    ".convax/protocol-v3/active.jcs",
  ] as const
  const present = expected.filter((candidate) => plan.preview.some(({ path }) => path === candidate))
  if (present.length === 0) return false
  if (present.length !== expected.length) throw new TeamProjectResetUnavailableError()
  for (const candidate of expected) {
    const stat = await fs.lstat(path.join(plan.projectRoot, candidate))
    if (!stat.isFile() || stat.isSymbolicLink()) throw new TeamProjectResetUnavailableError()
  }
  return true
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
