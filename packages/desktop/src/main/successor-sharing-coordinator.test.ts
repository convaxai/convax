import { describe, expect, test } from "bun:test"
import {
  ordinarySha256V2,
  encodeRestrictedJcsV2,
  parseId128V2,
  parseProjectIdV2,
  parseSignatureV2,
  projectSharingHandoffCoreDigestV3,
  type ProjectSharingHandoffProposalV3,
} from "@convax/collaboration"
import { SuccessorProjectSharingCoordinatorV3 } from "./successor-sharing-coordinator"

const digest = (value: string) => ordinarySha256V2(new TextEncoder().encode(value))
const projectId = parseProjectIdV2(`project_${"a".repeat(64)}`)
const id = parseId128V2("AAAAAAAAAAAAAAAAAAAAAA")
const signature = parseSignatureV2("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA")

describe("V3 explicit sharing coordinator", () => {
  test("starts transport only after durable Team installation", async () => {
    const events: string[] = []
    const proposal = fixtureProposal()
    const coordinator = fixture({
      proposal,
      events,
      remote: { status: "committed", receipt: fixtureReceipt(proposal), teamArtifacts: {} as never },
    })
    expect(await coordinator.share(projectId)).toBe("shared")
    await Promise.resolve()
    expect(events).toEqual(["quiesce", "flush", "begin", "submit", "verify", "install", "start"])
  })

  test("lost response stays recovery-required and recovery installs the exact receipt", async () => {
    const events: string[] = []
    const proposal = fixtureProposal()
    const committed = { status: "committed" as const, receipt: fixtureReceipt(proposal), teamArtifacts: {} as never }
    const coordinator = fixture({ proposal, events, submitError: true, recover: committed })
    expect(await coordinator.share(projectId)).toBe("handoff-recovery-required")
    expect(events).not.toContain("install")
    expect(await coordinator.recover(projectId)).toBe("shared")
  })

  test("cancellation before durable begin performs no remote call", async () => {
    const events: string[] = []
    const signal = AbortSignal.abort()
    const coordinator = fixture({ proposal: fixtureProposal(), events })
    expect(await coordinator.share(projectId, signal)).toBe("cancelled")
    expect(events).toEqual(["quiesce", "resume"])
  })
})

function fixture(input: {
  proposal: ProjectSharingHandoffProposalV3
  events: string[]
  remote?: any
  recover?: any
  submitError?: boolean
}) {
  return new SuccessorProjectSharingCoordinatorV3({
    transition: {
      async begin() { input.events.push("begin"); return "recorded" },
      async loadPending() { return input.proposal },
      async installCommitted() { input.events.push("install"); return "installed" },
    },
    mutationBarrier: {
      async quiesce() { input.events.push("quiesce") },
      async resumeLocal() { input.events.push("resume") },
      async flushAndBuildProposal() { input.events.push("flush"); return input.proposal },
    },
    remote: {
      async submit() { input.events.push("submit"); if (input.submitError) throw new Error("lost"); return input.remote ?? { status: "pending" } },
      async recover() { input.events.push("recover"); return input.recover ?? { status: "pending" } },
    },
    async verifyCommitted() { input.events.push("verify"); return "verified" },
    async startSharedRuntime() { input.events.push("start") },
  })
}

function fixtureProposal(): ProjectSharingHandoffProposalV3 {
  const core = {
    format: "convax.project-sharing-handoff-core/3" as const,
    handoffId: id, projectId, projectEpoch: id,
    previousOwnerBindingCoreDigest: digest("binding"), previousOwnerKeyId: digest("owner-key"), sharingGeneration: "1" as const,
    projectIndexHead: { scope: { projectId, projectEpoch: id, docKind: "project-index" as const, docId: "project-index" as const, shardEpoch: id }, acceptedFrontierDigest: digest("frontier"), acceptedHeadDigest: digest("head") },
    liveCanvasHeads: [], serviceTrustBundleDigest: digest("trust"), initialMembershipSnapshotDigest: digest("membership"), initialOwnerMemberId: id as never,
    initialMemberCredentialCoreDigest: digest("member"), initialAdminCapabilityCoreDigest: digest("admin"), initialOwnerReplicaId: "replica_00000001" as never,
    initialOwnerActorId: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" as never, initialReplicaActorCredentialCoreDigest: digest("actor"), initialReplicaEditAuthorizationCoreDigest: digest("edit"), successorProtocolDigest: digest("protocol"),
  }
  return { format: "convax.project-sharing-handoff-proposal/3", core, coreDigest: projectSharingHandoffCoreDigestV3(core), ownerSignature: signature }
}

function fixtureReceipt(proposal: ProjectSharingHandoffProposalV3) {
  const serviceSigningPublicKey = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
  const domain = new TextEncoder().encode("convax.project-sharing-service-public-key/3")
  const key = encodeRestrictedJcsV2(serviceSigningPublicKey)
  const preimage = new Uint8Array(domain.length + 1 + key.length)
  preimage.set(domain); preimage.set(key, domain.length + 1)
  return { format: "convax.project-sharing-handoff-receipt/3", core: proposal.core, coreDigest: proposal.coreDigest, ownerSignature: proposal.ownerSignature, serviceSigningPublicKey, serviceSigningKeyId: ordinarySha256V2(preimage), serviceSignature: signature } as never
}
