import { describe, expect, test } from "bun:test"
import * as Y from "yjs"
import {
  encodeBase64urlV2, parseActorIdV2, parseCanvasIdV2, parseDigestV2, parseId128V2,
  parseMemberIdV2, parseProjectIdV2, parsePublicKeyV2, parseReplicaIdV2,
  parseSignatureV2, parseUint64V2,
} from "./codecs"
import { causalFrontierDigestV2 } from "./causal"
import { ordinarySha256V2 } from "./digest"
import { actualWriteEvidenceDigestV2 } from "./frame"
import { encodeRestrictedJcsV2 } from "./jcs"
import {
  localOwnerEditAuthorizationCoreDigestV3, localProjectOwnerBindingCoreDigestV3,
  causalSignerAuthorityDigestV3, type CausalSignerAuthorityV3,
} from "./successor-authority"
import {
  createCandidateIncomingFrameAdmissionStrategyV3,
  createSelectedIncomingAuthorityVerificationPortV3,
} from "./successor-admission"
import {
  causalContextDigestV3, causalEditCoreDigestV3, createCandidateSuccessorProtocolAuthorityV3,
  decodeCausalEditFrameV3,
  encodeCausalEditFrameV3,
} from "./successor-frame"
import { encodeStateVectorV2, stateVectorDigestV2, yjsUpdateDigestV2 } from "./yjs-codec"

const fill = (length: number, value: number) => new Uint8Array(length).fill(value)
const digest = (value: string) => parseDigestV2(ordinarySha256V2(new TextEncoder().encode(value)))
const PROJECT = parseProjectIdV2("successor-admission-project")
const EPOCH = parseId128V2(encodeBase64urlV2(fill(16, 2)))
const SHARD = parseId128V2(encodeBase64urlV2(fill(16, 3)))
const ACTOR = parseActorIdV2(encodeBase64urlV2(fill(32, 4)))
const REPLICA = parseReplicaIdV2("replica_00000001")
const CANVAS = parseCanvasIdV2(`cv_${"6".repeat(64)}`)
const PROTOCOL = digest("protocol")
const SCHEMA = digest("schema")
const scope = Object.freeze({ projectId: PROJECT, projectEpoch: EPOCH, docKind: "canvas" as const, docId: CANVAS, shardEpoch: SHARD })
const PUBLIC_KEY = parsePublicKeyV2(encodeBase64urlV2(fill(32, 4)))
const OTHER_KEY = parsePublicKeyV2(encodeBase64urlV2(fill(32, 5)))
const SIGNATURE = parseSignatureV2(encodeBase64urlV2(Uint8Array.from({ length: 64 }, (_, index) => index < 32 ? 3 : index === 32 ? 1 : 0)))

function localProof() {
  const ownerKeyId = structuredDigest("convax.local-project-owner-public-key/3", PUBLIC_KEY)
  const bindingCore = Object.freeze({
    format: "convax.local-project-owner-binding-core/3" as const,
    projectId: PROJECT, projectEpoch: EPOCH, ownerKeyId, ownerPublicKey: PUBLIC_KEY,
    initialReplicaId: REPLICA, initialActorId: ACTOR, protocolDigest: PROTOCOL,
    genesisAuthorizationPolicy: Object.freeze({
      format: "convax.local-owner-genesis-authorization-policy/3" as const,
      projectIndexScope: Object.freeze({ ...scope, docKind: "project-index" as const, docId: "project-index" as const }),
      canvasAuthorization: "accepted-project-index-route-genesis-only" as const,
    }),
    sharingGeneration: "0" as const, creationNonce: EPOCH,
  })
  const binding = Object.freeze({ format: "convax.local-project-owner-binding/3" as const, core: bindingCore, coreDigest: localProjectOwnerBindingCoreDigestV3(bindingCore), ownerSignature: SIGNATURE })
  const authorizationCore = Object.freeze({
    format: "convax.local-owner-edit-authorization-core/3" as const,
    ownerBindingCoreDigest: binding.coreDigest, projectId: PROJECT, projectEpoch: EPOCH, scope,
    replicaId: REPLICA, actorId: ACTOR, ownerSchemaDigest: SCHEMA,
    actorSequenceAllocationPolicy: Object.freeze({ format: "convax.local-owner-actor-sequence-allocation-policy/3" as const, kind: "strict-durable-head-successor" as const, initialSequence: "1" as const }),
    protocolDigest: PROTOCOL, sharingGeneration: "0" as const, expiryPolicy: "none" as const,
  })
  const authorization = Object.freeze({ format: "convax.local-owner-edit-authorization/3" as const, core: authorizationCore, coreDigest: localOwnerEditAuthorizationCoreDigestV3(authorizationCore), ownerSignature: SIGNATURE })
  const authority = Object.freeze({
    kind: "local-project-owner" as const, ownerKeyId, replicaId: REPLICA, actorId: ACTOR,
    ownerBindingCoreDigest: binding.coreDigest, ownerEditAuthorizationCoreDigest: authorization.coreDigest,
  })
  return { authority, binding, authorization }
}

function teamAuthority() {
  return Object.freeze({
    kind: "team-replica" as const,
    memberId: parseMemberIdV2(encodeBase64urlV2(fill(16, 8))), replicaId: REPLICA, actorId: ACTOR,
    memberAuthorizationEpoch: EPOCH, replicaAuthorizationEpoch: SHARD,
    membershipSnapshotDigest: digest("membership"), replicaActorCredentialCoreDigest: digest("credential"),
    replicaEditAuthorizationCoreDigest: digest("edit-auth"),
  })
}

function frameBytes(authority: CausalSignerAuthorityV3) {
  const vector = encodeStateVectorV2(new Y.Doc())
  const intentJcs = encodeRestrictedJcsV2({ format: "convax.typed-intent/2", kind: "canvas.node.create", value: {} })
  const intentDigest = rawDigest("convax.typed-intent/3", intentJcs)
  const authorityDependencies = authority.kind === "local-project-owner"
    ? [
        { kind: "local-owner-binding" as const, digest: authority.ownerBindingCoreDigest },
        { kind: "local-owner-edit-authorization" as const, digest: authority.ownerEditAuthorizationCoreDigest },
      ]
    : [
        { kind: "membership-snapshot" as const, digest: authority.membershipSnapshotDigest },
        { kind: "replica-actor-credential" as const, digest: authority.replicaActorCredentialCoreDigest },
        { kind: "replica-edit-authorization" as const, digest: authority.replicaEditAuthorizationCoreDigest },
      ]
  const frontier = { format: "convax.causal-frontier/2" as const, heads: [] }
  const context = Object.freeze({
    format: "convax.causal-context/3" as const, scope, baseFrontier: frontier,
    baseFrontierDigest: causalFrontierDigestV2(frontier), baseStateVectorDigest: stateVectorDigestV2(vector),
    baseCanonicalStateDigest: digest("base"), signerAuthority: authority,
    dependencies: authorityDependencies, validationArtifactSetDigest: digest("artifacts"),
  })
  const contextJcs = encodeRestrictedJcsV2(context)
  const evidence = { format: "convax.actual-write-evidence/2" as const, scope, owner: "canvas" as const, ownerSchemaDigest: SCHEMA, intentDigest, changedPaths: [], writes: [] }
  const evidenceJcs = encodeRestrictedJcsV2(evidence), update = new Uint8Array()
  const core = Object.freeze({
    format: "convax.causal-edit-core/3" as const, scope, actorId: ACTOR, actorSequence: parseUint64V2("1"),
    predecessorFrameDigest: digest("predecessor"), operationId: EPOCH, lamport: parseUint64V2("1"),
    intentKind: "canvas.node.create", intentDigest, causalContextDigest: causalContextDigestV3(context),
    baseFrontierDigest: context.baseFrontierDigest, baseStateVectorDigest: context.baseStateVectorDigest,
    baseCanonicalStateDigest: context.baseCanonicalStateDigest, yjsUpdateDigest: yjsUpdateDigestV2(update),
    postStateVectorDigest: stateVectorDigestV2(vector), postCanonicalStateDigest: digest("post"),
    actualWriteEvidenceDigest: actualWriteEvidenceDigestV2(evidence),
    typedIntentJcsByteLength: parseUint64V2(String(intentJcs.byteLength)), causalContextJcsByteLength: parseUint64V2(String(contextJcs.byteLength)),
    baseStateVectorByteLength: parseUint64V2(String(vector.byteLength)), yjsUpdateByteLength: parseUint64V2("0"),
    actualWriteEvidenceJcsByteLength: parseUint64V2(String(evidenceJcs.byteLength)), protocolDigest: PROTOCOL,
    ownerSchemaDigest: SCHEMA, canonicalizerDigest: digest("canonicalizer"), validationArtifactSetDigest: context.validationArtifactSetDigest,
    signerAuthorityKind: authority.kind, signerAuthorityDigest: causalSignerAuthorityDigestV3(authority),
  })
  return encodeCausalEditFrameV3(createCandidateSuccessorProtocolAuthorityV3(PROTOCOL), {
    header: { format: "convax.causal-edit-frame/3", core, coreDigest: causalEditCoreDigestV3(core, PROTOCOL), replicaSignature: SIGNATURE },
    sections: { typedIntentJcs: intentJcs, causalContextJcs: contextJcs, baseStateVector: vector, yjsUpdate: update, actualWriteEvidenceJcs: evidenceJcs },
  })
}

function strategy(overrides: { sharing?: "unshared" | "shared" | "ambiguous"; localStatus?: "resolved" | "pending" | "rejected"; teamStatus?: "resolved" | "pending" | "rejected"; teamKey?: typeof PUBLIC_KEY; teamScope?: typeof scope; teamAuthorityOverride?: ReturnType<typeof teamAuthority> } = {}) {
  const local = localProof(), team = teamAuthority()
  return createCandidateIncomingFrameAdmissionStrategyV3({
    candidate: createCandidateSuccessorProtocolAuthorityV3(PROTOCOL), verifier: { async verify() { return true } },
    resolver: {
      async resolveLocalOwner() {
        if (overrides.localStatus && overrides.localStatus !== "resolved") return { status: overrides.localStatus } as const
        return { status: "resolved" as const, proof: { binding: local.binding, authorization: local.authorization, ownerSchemaDigest: SCHEMA, sharingState: { async resolve() { return overrides.sharing ?? "unshared" } } } }
      },
      async resolveTeamReplica() {
        if (overrides.teamStatus && overrides.teamStatus !== "resolved") return { status: overrides.teamStatus } as const
        return { status: "resolved" as const, proof: { authority: overrides.teamAuthorityOverride ?? team, scope: overrides.teamScope ?? scope, replicaPublicKey: overrides.teamKey ?? PUBLIC_KEY } }
      },
    },
  })
}

describe("candidate successor incoming admission", () => {
  test("selected decoded-frame port reuses exact local and Team proof admission without decoding bytes", async () => {
    const local = localProof(), team = teamAuthority()
    const localResolverCalls: string[] = []
    const selected = createSelectedIncomingAuthorityVerificationPortV3({
      verifier: { async verify() { return true } },
      resolver: {
        async resolveLocalOwner() {
          localResolverCalls.push("local")
          return { status: "resolved" as const, proof: { binding: local.binding, authorization: local.authorization, ownerSchemaDigest: SCHEMA, sharingState: { async resolve() { return "unshared" as const } } } }
        },
        async resolveTeamReplica() {
          localResolverCalls.push("team")
          return { status: "resolved" as const, proof: { authority: team, scope, replicaPublicKey: PUBLIC_KEY } }
        },
      },
    })
    const authority = createCandidateSuccessorProtocolAuthorityV3(PROTOCOL)
    const localFrame = decodeCausalEditFrameV3(authority, frameBytes(local.authority))
    await expect(selected.verifyFrameAuthority(localFrame)).resolves.toEqual({ replicaPublicKey: PUBLIC_KEY })
    expect(localResolverCalls).toEqual(["local"])
    const teamFrame = decodeCausalEditFrameV3(authority, frameBytes(team))
    await expect(selected.verifyFrameAuthority(teamFrame)).resolves.toEqual({ replicaPublicKey: PUBLIC_KEY })
    expect(localResolverCalls).toEqual(["local", "team"])
  })

  test("preserves pending and rejected proof states without trying the other signer kind", async () => {
    const bytes = frameBytes(localProof().authority)
    await expect(strategy({ localStatus: "pending" }).verifyExactFrame(bytes)).resolves.toEqual({ status: "pending" })
    await expect(strategy({ localStatus: "rejected" }).verifyExactFrame(bytes)).resolves.toEqual({ status: "rejected" })
  })

  test("rejects local-owner frames after sharing handoff and never falls back to Team", async () => {
    const bytes = frameBytes(localProof().authority)
    await expect(strategy({ sharing: "shared" }).verifyExactFrame(bytes)).resolves.toEqual({ status: "rejected" })
    await expect(strategy({ sharing: "ambiguous" }).verifyExactFrame(bytes)).resolves.toEqual({ status: "rejected" })
  })

  test("accepts an exact Team proof but rejects key substitution, cross-scope and authority substitution", async () => {
    const team = teamAuthority(), bytes = frameBytes(team)
    await expect(strategy().verifyExactFrame(bytes)).resolves.toMatchObject({ status: "accepted", replicaPublicKey: PUBLIC_KEY })
    const keyChecking = createCandidateIncomingFrameAdmissionStrategyV3({
      candidate: createCandidateSuccessorProtocolAuthorityV3(PROTOCOL),
      verifier: { async verify(key) { return encodeBase64urlV2(key) === PUBLIC_KEY } },
      resolver: { async resolveLocalOwner() { return { status: "rejected" } as const }, async resolveTeamReplica() { return { status: "resolved" as const, proof: { authority: team, scope, replicaPublicKey: OTHER_KEY } } } },
    })
    await expect(keyChecking.verifyExactFrame(bytes)).resolves.toEqual({ status: "rejected" })
    await expect(strategy({ teamScope: { ...scope, shardEpoch: EPOCH } }).verifyExactFrame(bytes)).resolves.toEqual({ status: "rejected" })
    await expect(strategy({ teamAuthorityOverride: { ...team, replicaAuthorizationEpoch: EPOCH } }).verifyExactFrame(bytes)).resolves.toEqual({ status: "rejected" })
  })
})

function structuredDigest(domain: `${string}/3`, value: unknown) {
  return rawDigest(domain, encodeRestrictedJcsV2(value))
}
function rawDigest(domain: string, value: Uint8Array) {
  const prefix = new TextEncoder().encode(domain), input = new Uint8Array(prefix.length + 1 + value.length)
  input.set(prefix); input[prefix.length] = 0; input.set(value, prefix.length + 1)
  return ordinarySha256V2(input)
}
