import { describe, expect, test } from "bun:test"
import {
  encodeBase64url,
  encodeRestrictedJcsText,
  parseActorId,
  parseDigest,
  parseId128,
  parseMemberId,
  parseProjectId,
  parseReplicaId,
  parseSignature,
  parseUint32,
  parseUint64,
} from "@convax/collaboration"
import { PROJECT_CONTROL_PROTOCOL_KERNEL_INTEGRATION_V2 } from "./kernel-integration"
import {
  parseDocumentRegistrationClaimV2,
  parseReplicaProjectFloorPageV2,
  registrationClaimCoreDigestV2,
  replicaProjectFloorPageCoreDigestV2,
} from "./metadata-codecs"
import { parseProjectResetApprovalV2, projectResetApprovalCoreDigestV2 } from "./reset-codecs"

const bytes = (length: number, value: number) => encodeBase64url(new Uint8Array(length).fill(value))
const id = (value: number) => parseId128(bytes(16, value))
const digest = (value: string) => parseDigest(value.repeat(64))
const signature = parseSignature(bytes(64, 9))
const projectId = parseProjectId("codec-project")
const projectEpoch = id(1)
const scope = Object.freeze({ projectId, projectEpoch, docKind: "project-index" as const, docId: "project-index" as const, shardEpoch: id(2) })
const protocolDigest = parseDigest(PROJECT_CONTROL_PROTOCOL_KERNEL_INTEGRATION_V2.requiredProtocolDigest)

describe("Project metadata/reset public codecs", () => {
  test("closes Project-floor and registration artifacts and rejects unknown fields", () => {
    const pageCore = Object.freeze({ format: "convax.replica-project-floor-page-core/2" as const, floorSetId: id(3), targetReplicaId: parseReplicaId("replica_00000001"), pageIndex: parseUint32("0"), firstScopeKey: encodeRestrictedJcsText(scope), lastScopeKey: encodeRestrictedJcsText(scope), entries: [Object.freeze({ scope, basis: "project-index" as const, prunableCheckpointSetCertificateDigest: digest("1"), replicaCausalFloorAckDigest: digest("2") })] })
    const page = Object.freeze({ format: "convax.replica-project-floor-page/2" as const, core: pageCore, coreDigest: replicaProjectFloorPageCoreDigestV2(pageCore) })
    expect(parseReplicaProjectFloorPageV2(page)).toEqual(page)

    const claimCore = Object.freeze({ format: "convax.document-registration-claim-core/2" as const, scope, registrarMemberId: parseMemberId(id(4)), registrarReplicaId: parseReplicaId("replica_00000001"), registrarActorId: parseActorId(bytes(32, 5)), registrarAuthorizationDigest: digest("3"), claimRevision: parseUint64("1"), genesisCheckpointDigest: digest("4"), projectIndexRouteDependencyDigest: digest("5"), protocolDigest })
    const claim = Object.freeze({ format: "convax.document-registration-claim/2" as const, core: claimCore, coreDigest: registrationClaimCoreDigestV2(claimCore), replicaSignature: signature })
    expect(parseDocumentRegistrationClaimV2(claim)).toEqual(claim)
    expect(() => parseDocumentRegistrationClaimV2({ ...claim, extra: true })).toThrow()
  })

  test("closes team Project reset approval without compatibility fields", () => {
    const core = Object.freeze({ format: "convax.project-reset-approval-core/2" as const, resetId: id(6), approvalId: id(7), confirmationCoreDigest: digest("6"), projectId, oldProjectEpoch: projectEpoch, reason: "explicit-empty-project-reset" as const, observedOldPrivateTreeDigest: digest("7"), unsupportedInventoryDigest: digest("8"), privateDeletionSetDigest: digest("9"), requestedProtocolDigest: protocolDigest, requestedSchemaDigest: digest("a"), requestedUriProtocolDigest: digest("b"), adminMemberId: parseMemberId(id(8)), adminMemberAuthorizationEpoch: id(9), adminCapabilityCoreDigest: digest("c"), approvalStatement: "approve-exact-team-project-reset" as const, protocolDigest })
    const approval = Object.freeze({ format: "convax.project-reset-approval/2" as const, core, coreDigest: projectResetApprovalCoreDigestV2(core), adminMemberSignature: signature })
    expect(parseProjectResetApprovalV2(approval)).toEqual(approval)
    expect(() => parseProjectResetApprovalV2({ ...approval, core: { ...core, legacyResetVersion: 1 } })).toThrow()
  })
})
