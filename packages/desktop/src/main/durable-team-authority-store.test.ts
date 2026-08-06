import { describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import {
  encodeBase64url,
  parseDigest,
  parseId128,
  parseMemberId,
  parseProjectId,
  parsePublicKey,
  parseSignature,
  parseUint64,
  structuredDigest,
} from "@convax/collaboration"
import {
  CONTROL_PROTOCOL_EXPECTED_IDENTITIES,
  type MemberCredential,
  type MembershipSnapshot,
  type ProjectAdminCapability,
} from "@convax/project/collaboration-protocol"

import {
  NodeDurableTeamAuthorityStore,
  createDesktopTeamAuthorityAdmission,
  type DesktopTeamAuthorityCandidate,
} from "./durable-team-authority-store"

const id = (byte: number) => parseId128(encodeBase64url(new Uint8Array(16).fill(byte)))
const digest = (digit: string) => parseDigest(digit.repeat(64))
const projectId = parseProjectId("project-team-authority")
const memberId = parseMemberId(id(2))
const publicKey = parsePublicKey(encodeBase64url(new Uint8Array(32).fill(3)))
const signature = parseSignature(encodeBase64url(new Uint8Array(64).fill(4)))
const protocolDigest = parseDigest(CONTROL_PROTOCOL_EXPECTED_IDENTITIES.protocolDigest)
const trustBundleDigest = digest("2")

describe("NodeDurableTeamAuthorityStore", () => {
  test("installs only admitted graphs and reopens exact canonical bytes", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "convax-team-authority-"))
    const store = new NodeDurableTeamAuthorityStore(path.join(root, "authority"))
    const admission = createDesktopTeamAuthorityAdmission({
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
    const store = new NodeDurableTeamAuthorityStore(path.join(root, "authority"))
    const admission = createDesktopTeamAuthorityAdmission({
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
      } as MemberCredential,
    }
    await expect(admission.admit(crossed)).resolves.toBe("rejected")
    const badSignature = createDesktopTeamAuthorityAdmission({
      protocolDigest, trustBundleDigest, verifier: { async verify() { return false } },
    })
    await expect(badSignature.admit(candidate("1"))).resolves.toBe("rejected")
  })
})

function candidate(sequence: string, membershipEpoch = id(6)): DesktopTeamAuthorityCandidate {
  const memberAuthorizationEpoch = id(5)
  const snapshotCore = {
    format: "convax.membership-snapshot-core" as const,
    projectId, projectEpoch: id(4), membershipEpoch, membershipSequence: parseUint64(sequence),
    registrySequence: parseUint64("1"), registryRootDigest: digest("3"),
    members: [{ memberId, memberSigningPublicKey: publicKey, role: "editor" as const, state: "active" as const, memberAuthorizationEpoch, memberMutationCounter: parseUint64(sequence) }],
    replicas: [], protocolDigest, trustBundleDigest, serviceKeyPurpose: "membership" as const, serviceKeyId: "membership-1",
  }
  const membershipSnapshot: MembershipSnapshot = {
    format: "convax.membership-snapshot", core: snapshotCore,
    coreDigest: structuredDigest("convax.membership-snapshot-core", snapshotCore), serviceSignature: signature,
  }
  const adminCore = {
    format: "convax.project-admin-capability-core" as const,
    projectId, projectEpoch: snapshotCore.projectEpoch, membershipEpoch: snapshotCore.membershipEpoch,
    membershipSnapshotDigest: membershipSnapshot.coreDigest, adminMemberId: memberId,
    adminMemberAuthorizationEpoch: memberAuthorizationEpoch, grants: ["membership-admin"] as const,
    protocolDigest, trustBundleDigest, serviceKeyPurpose: "membership" as const, serviceKeyId: "membership-1",
  }
  const adminCapability: ProjectAdminCapability = {
    format: "convax.project-admin-capability", core: adminCore,
    coreDigest: structuredDigest("convax.project-admin-capability-core", adminCore), serviceSignature: signature,
  }
  const credentialCore = {
    format: "convax.member-credential-core" as const,
    projectId, projectEpoch: snapshotCore.projectEpoch, membershipEpoch: snapshotCore.membershipEpoch,
    membershipSnapshotDigest: membershipSnapshot.coreDigest, memberId, memberSigningPublicKey: publicKey,
    role: "editor" as const, memberAuthorizationEpoch, adminCapabilityDigest: adminCapability.coreDigest,
    protocolDigest, trustBundleDigest, serviceKeyPurpose: "membership" as const, serviceKeyId: "membership-1",
  }
  const memberCredential: MemberCredential = {
    format: "convax.member-credential", core: credentialCore,
    coreDigest: structuredDigest("convax.member-credential-core", credentialCore), serviceSignature: signature,
  }
  return { membershipSnapshot, memberCredential, adminCapability, replicaActorCredential: null, replicaEditAuthorization: null }
}
