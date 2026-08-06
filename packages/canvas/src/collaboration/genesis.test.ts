import { describe, expect, test } from "bun:test"
import {
  encodeBase64url,
  installCurrentProtocolAuthority,
  parseActorId,
  parseCanvasId,
  parseDigest,
  parseId128,
  parseMemberId,
  parseProjectId,
  parseReplicaId,
  parseSignature,
  createSelectedDocumentOwnerArtifactFactory,
  type ValidationArtifactRef,
  type CurrentProtocolAuthority,
} from "@convax/collaboration"
import { selectedCanvasDocumentOwnerArtifactDefinition } from "./session"
import {
  buildCanvasGenesisProofCarrier,
  installCanvasGenesisProofCarrierVerifierFactory,
  type CanvasGenesisBuildAuthor,
  type CanvasGenesisHistoricalAuthorVerifierPort,
} from "./genesis"

describe("current CVXCGP02 Canvas genesis proof carrier", () => {
  test("builds exact checkpoint/carrier bytes and validates the closed Canvas identity", async () => {
    const authority = await loadAuthority()
    const runtimeResult = createSelectedDocumentOwnerArtifactFactory(authority, "canvas")
      .createRuntime(selectedCanvasDocumentOwnerArtifactDefinition)
    if ("status" in runtimeResult) throw new Error(runtimeResult.code)
    const author = buildAuthor(authority)
    const historicalAuthorVerifier: CanvasGenesisHistoricalAuthorVerifierPort = {
      verifyHistoricalAuthor(input) {
        if (
          input.checkpoint.core.authorReplicaId !== author.authorReplicaId ||
          input.checkpoint.core.authorActorId !== author.authorActorId
        ) return { status: "rejected" }
        return Object.freeze({
          status: "verified",
          authorActorId: author.authorActorId,
          authorReplicaId: author.authorReplicaId,
          authorCredentialCoreDigest: author.checkpointAuthorCredentialCoreDigest,
        })
      },
    }
    const factory = installCanvasGenesisProofCarrierVerifierFactory({ authority, historicalAuthorVerifier })
    const created = factory.createVerifier(runtimeResult)
    if (created.status !== "created") throw new Error(created.code)
    const scope = Object.freeze({
      projectId: parseProjectId("project"),
      projectEpoch: id128(1),
      docKind: "canvas" as const,
      docId: parseCanvasId(`cv_${"2".repeat(64)}`),
      shardEpoch: id128(2),
    })
    const result = await buildCanvasGenesisProofCarrier({
      authority,
      runtime: runtimeResult,
      verifier: created.verifier,
      scope,
      projectIndexRouteDependencyFrameDigest: digest(90),
      author,
    })

    expect(result.status).toBe("built")
    if (result.status !== "built") return
    expect(new TextDecoder().decode(result.proofCarrierExactBytes.slice(0, 8))).toBe("CVXCGP02")
    expect(result.validatedIdentity.identity.projectIndexRouteDependencyFrameDigest).toBe(digest(90))
    expect(result.validatedIdentity.checkpointObjectDigest).toBe(result.checkpointObjectDigest)
    expect(created.verifier(result.proofCarrierExactBytes).status).toBe("validated")
  })

  test("rejects a tampered section and never exposes a partial identity", async () => {
    const authority = await loadAuthority()
    const runtimeResult = createSelectedDocumentOwnerArtifactFactory(authority, "canvas")
      .createRuntime(selectedCanvasDocumentOwnerArtifactDefinition)
    if ("status" in runtimeResult) throw new Error(runtimeResult.code)
    const author = buildAuthor(authority)
    const factory = installCanvasGenesisProofCarrierVerifierFactory({
      authority,
      historicalAuthorVerifier: {
        verifyHistoricalAuthor: () => ({
          status: "verified",
          authorActorId: author.authorActorId,
          authorReplicaId: author.authorReplicaId,
          authorCredentialCoreDigest: author.checkpointAuthorCredentialCoreDigest,
        }),
      },
    })
    const created = factory.createVerifier(runtimeResult)
    if (created.status !== "created") throw new Error(created.code)
    const built = await buildCanvasGenesisProofCarrier({
      authority,
      runtime: runtimeResult,
      verifier: created.verifier,
      scope: {
        projectId: parseProjectId("project"), projectEpoch: id128(3), docKind: "canvas",
        docId: parseCanvasId(`cv_${"3".repeat(64)}`), shardEpoch: id128(4),
      },
      projectIndexRouteDependencyFrameDigest: digest(91),
      author,
    })
    if (built.status !== "built") throw new Error("failed to build test carrier")
    const tampered = new Uint8Array(built.proofCarrierExactBytes)
    tampered[tampered.length - 1] ^= 1
    const result = created.verifier(tampered)
    expect(result.status).toBe("rejected")
    expect("identity" in result).toBe(false)
  })
})

function buildAuthor(authority: CurrentProtocolAuthority): CanvasGenesisBuildAuthor {
  const byName = new Map(authority.protocolSchemaBundle.core.artifacts.map((artifact) => [artifact.name, artifact]))
  const artifact = (
    owner: ValidationArtifactRef["owner"],
    name: "canvas-schema" | "collaboration-kernel" | "control-plane" | "project-persistence",
  ) => {
    const selected = byName.get(name)!
    return Object.freeze({
      artifact: Object.freeze({ owner, format: selected.format, artifactDigest: selected.artifactDigest }),
      exactBytes: new TextEncoder().encode(`selected:${name}:${selected.artifactDigest}`),
    })
  }
  return Object.freeze({
    checkpointId: id128(10),
    authorMemberId: parseMemberId(encoded(11, 16)),
    authorReplicaId: parseReplicaId("replica_00000001"),
    authorActorId: parseActorId(encoded(12, 32)),
    authorAuthorizationDigest: digest(13),
    checkpointAuthorCredentialCoreDigest: digest(14),
    checkpointAuthorCredentialExactBytes: new TextEncoder().encode("credential"),
    checkpointAuthorMembershipSnapshotCoreDigest: digest(15),
    checkpointAuthorMembershipSnapshotExactBytes: new TextEncoder().encode("membership"),
    checkpointAuthorReservationReceiptCoreDigest: digest(16),
    checkpointAuthorReservationReceiptExactBytes: new TextEncoder().encode("reservation"),
    serviceTrustBundleCoreDigest: digest(17),
    serviceTrustBundleExactBytes: new TextEncoder().encode("trust"),
    validationArtifacts: Object.freeze([
      artifact("canvas", "canvas-schema"),
      artifact("control-plane", "control-plane"),
      artifact("kernel", "collaboration-kernel"),
      artifact("project-index", "project-persistence"),
    ]),
    signCheckpointCoreDigest: async () => parseSignature(encodeBase64url(new Uint8Array(64).fill(1))),
  })
}

async function loadAuthority(): Promise<CurrentProtocolAuthority> {
  return installCurrentProtocolAuthority()
}

function id128(seed: number) { return parseId128(encoded(seed, 16)) }
function digest(seed: number) { return parseDigest([...bytes(seed, 32)].map((value) => value.toString(16).padStart(2, "0")).join("")) }
function encoded(seed: number, length: number) { return encodeBase64url(bytes(seed, length)) }
function bytes(seed: number, length: number) { return Uint8Array.from({ length }, (_, index) => (seed * 17 + index * 29) & 0xff) }
