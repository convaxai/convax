import { describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import {
  encodeBase64urlV2,
  parseDigestV2,
  parseId128V2,
  parseMemberIdV2,
  parseProjectIdV2,
  parsePublicKeyV2,
  parseSignatureV2,
  parseUint64V2,
  structuredDigestV2,
} from "@convax/collaboration"
import {
  CONTROL_PROTOCOL_EXPECTED_IDENTITIES_V2,
  type MemberCredentialV2,
  type MembershipSnapshotV2,
  type ProjectAdminCapabilityV2,
} from "@convax/project/collaboration-protocol"

import {
  NodeDurableTeamAuthorityStoreV1,
  createDesktopTeamAuthorityAdmissionV1,
  type DesktopTeamAuthorityCandidateV1,
} from "./durable-team-authority-store"

const id = (byte: number) => parseId128V2(encodeBase64urlV2(new Uint8Array(16).fill(byte)))
const digest = (digit: string) => parseDigestV2(digit.repeat(64))
const projectId = parseProjectIdV2("project-team-authority")
const memberId = parseMemberIdV2(id(2))
const publicKey = parsePublicKeyV2(encodeBase64urlV2(new Uint8Array(32).fill(3)))
const signature = parseSignatureV2(encodeBase64urlV2(new Uint8Array(64).fill(4)))
const protocolDigest = parseDigestV2(CONTROL_PROTOCOL_EXPECTED_IDENTITIES_V2.protocolDigest)
const trustBundleDigest = digest("2")

describe("NodeDurableTeamAuthorityStoreV1", () => {
  test("installs only admitted graphs and reopens exact canonical bytes", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "convax-team-authority-"))
    const store = new NodeDurableTeamAuthorityStoreV1(path.join(root, "authority"))
    const admission = createDesktopTeamAuthorityAdmissionV1({
      protocolDigest, trustBundleDigest, verifier: { async verify() { return true } },
    })
    const verified = await admission.admit(candidate("1"))
    expect(verified).not.toBe("rejected")
    if (verified === "rejected") throw new Error("fixture rejected")
    await store.install(verified)
    await expect(store.open(projectId)).resolves.toMatchObject({
      projectId, memberId, membershipSnapshot: { core: { membershipSequence: "1" } },
    })
    await expect(store.install(verified)).rejects.toThrow("not verified")
    await expect(store.install({ record: verified.record } as never)).rejects.toThrow("not verified")
  })

  test("rejects signature failure, crossed graphs, rollback and same-sequence equivocation", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "convax-team-authority-"))
    const store = new NodeDurableTeamAuthorityStoreV1(path.join(root, "authority"))
    const admission = createDesktopTeamAuthorityAdmissionV1({
      protocolDigest, trustBundleDigest, verifier: { async verify() { return true } },
    })
    const second = await admission.admit(candidate("2"))
    if (second === "rejected") throw new Error("fixture rejected")
    await store.install(second)
    const first = await admission.admit(candidate("1"))
    if (first === "rejected") throw new Error("fixture rejected")
    await expect(store.install(first)).rejects.toThrow("rollback")

    const alternate = candidate("2", id(9))
    const equivocation = await admission.admit(alternate)
    if (equivocation === "rejected") throw new Error("fixture rejected")
    await expect(store.install(equivocation)).rejects.toThrow("equivocation")

    const crossedCandidate = candidate("3")
    const crossed = {
      ...crossedCandidate,
      memberCredential: {
        ...crossedCandidate.memberCredential,
        core: { ...crossedCandidate.memberCredential.core, membershipSnapshotDigest: digest("f") },
      } as MemberCredentialV2,
    }
    await expect(admission.admit(crossed)).resolves.toBe("rejected")
    const badSignature = createDesktopTeamAuthorityAdmissionV1({
      protocolDigest, trustBundleDigest, verifier: { async verify() { return false } },
    })
    await expect(badSignature.admit(candidate("1"))).resolves.toBe("rejected")
  })
})

function candidate(sequence: string, membershipEpoch = id(6)): DesktopTeamAuthorityCandidateV1 {
  const memberAuthorizationEpoch = id(5)
  const snapshotCore = {
    format: "convax.membership-snapshot-core/2" as const,
    projectId, projectEpoch: id(4), membershipEpoch, membershipSequence: parseUint64V2(sequence),
    registrySequence: parseUint64V2("1"), registryRootDigest: digest("3"),
    members: [{ memberId, memberSigningPublicKey: publicKey, role: "editor" as const, state: "active" as const, memberAuthorizationEpoch, memberMutationCounter: parseUint64V2(sequence) }],
    replicas: [], protocolDigest, trustBundleDigest, serviceKeyPurpose: "membership" as const, serviceKeyId: "membership-1",
  }
  const membershipSnapshot: MembershipSnapshotV2 = {
    format: "convax.membership-snapshot/2", core: snapshotCore,
    coreDigest: structuredDigestV2("convax.membership-snapshot-core/2", snapshotCore), serviceSignature: signature,
  }
  const adminCore = {
    format: "convax.project-admin-capability-core/2" as const,
    projectId, projectEpoch: snapshotCore.projectEpoch, membershipEpoch: snapshotCore.membershipEpoch,
    membershipSnapshotDigest: membershipSnapshot.coreDigest, adminMemberId: memberId,
    adminMemberAuthorizationEpoch: memberAuthorizationEpoch, grants: ["membership-admin"] as const,
    protocolDigest, trustBundleDigest, serviceKeyPurpose: "membership" as const, serviceKeyId: "membership-1",
  }
  const adminCapability: ProjectAdminCapabilityV2 = {
    format: "convax.project-admin-capability/2", core: adminCore,
    coreDigest: structuredDigestV2("convax.project-admin-capability-core/2", adminCore), serviceSignature: signature,
  }
  const credentialCore = {
    format: "convax.member-credential-core/2" as const,
    projectId, projectEpoch: snapshotCore.projectEpoch, membershipEpoch: snapshotCore.membershipEpoch,
    membershipSnapshotDigest: membershipSnapshot.coreDigest, memberId, memberSigningPublicKey: publicKey,
    role: "editor" as const, memberAuthorizationEpoch, adminCapabilityDigest: adminCapability.coreDigest,
    protocolDigest, trustBundleDigest, serviceKeyPurpose: "membership" as const, serviceKeyId: "membership-1",
  }
  const memberCredential: MemberCredentialV2 = {
    format: "convax.member-credential/2", core: credentialCore,
    coreDigest: structuredDigestV2("convax.member-credential-core/2", credentialCore), serviceSignature: signature,
  }
  return { membershipSnapshot, memberCredential, adminCapability, replicaActorCredential: null, replicaEditAuthorization: null }
}
