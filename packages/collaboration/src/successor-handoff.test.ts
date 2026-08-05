import { describe, expect, test } from "bun:test"
import { encodeBase64urlV2, parseActorIdV2, parseId128V2, parseMemberIdV2, parsePublicKeyV2, parseReplicaIdV2, parseSignatureV2 } from "./codecs"
import { ordinarySha256V2 } from "./digest"
import { encodeRestrictedJcsV2 } from "./jcs"
import { InMemoryProjectSharingHandoffSubmissionV3, parseProjectSharingHandoffCoreV3, parseProjectSharingHandoffReceiptV3, projectSharingHandoffCoreDigestV3, verifyProjectSharingHandoffReceiptV3, type ProjectSharingHandoffCoreV3 } from "./successor-handoff"

const id = parseId128V2(encodeBase64urlV2(new Uint8Array(16)))
const projectId = `project_${"a".repeat(64)}` as never
const digest = (x: string) => ordinarySha256V2(new TextEncoder().encode(x))
const signature = parseSignatureV2(encodeBase64urlV2(Uint8Array.from({ length: 64 }, (_, i) => i < 32 ? 2 : 0)))
const ownerKey = parsePublicKeyV2(encodeBase64urlV2(new Uint8Array(32).fill(2)))
const serviceKey = parsePublicKeyV2(encodeBase64urlV2(new Uint8Array(32).fill(1)))

function fixture(): ProjectSharingHandoffCoreV3 {
  const projectIndexScope = { projectId, projectEpoch: id, docKind: "project-index" as const, docId: "project-index" as const, shardEpoch: parseId128V2(encodeBase64urlV2(new Uint8Array(16).fill(1))) }
  const canvasScope = { projectId, projectEpoch: id, docKind: "canvas" as const, docId: `cv_${"c".repeat(64)}` as never, shardEpoch: parseId128V2(encodeBase64urlV2(new Uint8Array(16).fill(2))) }
  return {
    format: "convax.project-sharing-handoff-core/3", handoffId: id, projectId, projectEpoch: id,
    previousOwnerBindingCoreDigest: digest("binding"), previousOwnerKeyId: digest("owner-key"), sharingGeneration: "1",
    projectIndexHead: { scope: projectIndexScope, acceptedFrontierDigest: digest("p-frontier"), acceptedHeadDigest: digest("p-head") },
    liveCanvasHeads: [{ scope: canvasScope, acceptedFrontierDigest: digest("c-frontier"), acceptedHeadDigest: digest("c-head") }],
    serviceTrustBundleDigest: digest("trust"), initialMembershipSnapshotDigest: digest("membership"), initialOwnerMemberId: parseMemberIdV2(encodeBase64urlV2(new Uint8Array(16).fill(3))),
    initialMemberCredentialCoreDigest: digest("member-credential"), initialAdminCapabilityCoreDigest: digest("admin-capability"),
    initialOwnerReplicaId: parseReplicaIdV2("replica_00000001"), initialOwnerActorId: parseActorIdV2(encodeBase64urlV2(new Uint8Array(32).fill(2))),
    initialReplicaActorCredentialCoreDigest: digest("credential"), initialReplicaEditAuthorizationCoreDigest: digest("edit"), successorProtocolDigest: digest("protocol"),
  }
}

function receipt(core = fixture()) {
  const serviceKeyId = (() => { const d = new TextEncoder().encode("convax.project-sharing-service-public-key/3"); const b = encodeRestrictedJcsV2(serviceKey); const p = new Uint8Array(d.length + 1 + b.length); p.set(d); p.set(b, d.length + 1); return ordinarySha256V2(p) })()
  return { format: "convax.project-sharing-handoff-receipt/3" as const, core, coreDigest: projectSharingHandoffCoreDigestV3(core), ownerSignature: signature, serviceSigningPublicKey: serviceKey, serviceSigningKeyId: serviceKeyId, serviceSignature: signature }
}

function ownerKeyId() { const d = new TextEncoder().encode("convax.local-project-owner-public-key/3"); const b = encodeRestrictedJcsV2(ownerKey); const p = new Uint8Array(d.length + 1 + b.length); p.set(d); p.set(b, d.length + 1); return ordinarySha256V2(p) }

describe("successor sharing handoff", () => {
  test("rejects extra fields, cross-Project heads, and unsorted live Canvas closure", () => {
    expect(() => parseProjectSharingHandoffCoreV3({ ...fixture(), extra: true })).toThrow()
    const core = fixture(); expect(() => parseProjectSharingHandoffCoreV3({ ...core, liveCanvasHeads: [{ ...core.liveCanvasHeads[0], scope: { ...core.liveCanvasHeads[0]!.scope, projectId: `project_${"b".repeat(64)}` } }] })).toThrow("crossed")
    expect(() => parseProjectSharingHandoffCoreV3({ ...core, liveCanvasHeads: [core.liveCanvasHeads[0], core.liveCanvasHeads[0]] })).toThrow("strictly sorted")
  })

  test("requires exact owner and service signature ports", async () => {
    const parsed = parseProjectSharingHandoffReceiptV3(receipt({ ...fixture(), previousOwnerKeyId: ownerKeyId() }))
    let calls = 0
    const result = await verifyProjectSharingHandoffReceiptV3({ receipt: parsed, ownerPublicKey: ownerKey, expectedOwnerKeyId: parsed.core.previousOwnerKeyId,
      verifier: { async verify() { calls += 1; return true } }, serviceTrust: { async resolve() { return { status: "verified" as const, publicKey: serviceKey } } } })
    expect(result).toBe("verified"); expect(calls).toBe(2)
    await expect(verifyProjectSharingHandoffReceiptV3({ receipt: parsed, ownerPublicKey: ownerKey, expectedOwnerKeyId: parsed.core.previousOwnerKeyId,
      verifier: { async verify() { return true } }, serviceTrust: { async resolve() { return { status: "pending" as const } } } })).resolves.toBe("pending")
  })

  test("returns byte-identical receipt on retry and rejects handoff-id equivocation", async () => {
    const port = new InMemoryProjectSharingHandoffSubmissionV3(); const first = receipt(); const bytes = encodeRestrictedJcsV2(first)
    const one = await port.submit({ handoffId: first.core.handoffId, coreDigest: first.coreDigest, encodedReceipt: bytes })
    const two = await port.submit({ handoffId: first.core.handoffId, coreDigest: first.coreDigest, encodedReceipt: bytes })
    expect(one.status).toBe("committed"); expect(two).toEqual(one)
    const changedCore = { ...fixture(), initialMembershipSnapshotDigest: digest("other") }; const changed = receipt(changedCore)
    await expect(port.submit({ handoffId: changed.core.handoffId, coreDigest: changed.coreDigest, encodedReceipt: encodeRestrictedJcsV2(changed) })).resolves.toEqual({ status: "rejected" })
  })
})
