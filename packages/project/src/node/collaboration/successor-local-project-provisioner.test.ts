import { afterEach, describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import {
  encodeBase64urlV2,
  encodeRestrictedJcsV2,
  localOwnerEditAuthorizationCoreDigestV3,
  localProjectOwnerBindingCoreDigestV3,
  ordinarySha256V2,
  parseActorIdV2,
  parseCanvasIdV2,
  parseId128V2,
  parsePublicKeyV2,
  parseReplicaIdV2,
  parseSignatureV2,
  protocolPromotionBridgeCoreDigestV3,
  type DigestV2,
  type DocumentScopeV2,
  type LocalOwnerEditAuthorizationCoreV3,
  type LocalProjectOwnerBindingCoreV3,
  type ProtocolPromotionBridgeCoreV3,
} from "@convax/collaboration"
import { NodeSuccessorLocalOwnerAuthorityStoreV3 } from "./successor-local-owner-store"
import {
  SuccessorLocalProjectProvisionerV3,
  type NewLocalProjectProvisionInputV3,
  type SuccessorOwnerSigningPortV3,
  type VerifiedV10PromotionInspectionV3,
} from "./successor-local-project-provisioner"
import { NodeSuccessorProjectProtocolStateStoreV3 } from "./successor-protocol-state-store"

const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))))

describe("successor local Project provisioner", () => {
  test("claims before native key use and publishes ProjectIndex before the default Canvas", async () => {
    const fixture = await createFixture()
    const result = await fixture.provisioner.provisionNewProject(fixture.input)
    expect(result.status).toBe("ready")
    expect(fixture.events).toEqual(["identity", "binding", "authorization:project-index", "owner", "project-index", "bridge:project-index", "route-stage", "authorization:canvas", "owner", "canvas", "bridge:canvas", "route-activate"])
    expect((await fixture.protocolStore.open(fixture.input.projectId)).status).toBe("v3-local")
    const claim = await fs.readFile(path.join(fixture.projectPrivateDirectory, "protocol-v3", "local-provisioning-claim.jcs"))
    expect(claim.byteLength).toBeGreaterThan(0)
    const creationClaim = await fs.readFile(path.join(fixture.projectPrivateDirectory, "protocol-v3", "creation-claim.jcs"))
    if (result.status === "ready" && result.state.origin.kind === "new-project") {
      expect(result.state.origin.creationClaimDigest).toBe(ordinarySha256V2(creationClaim))
    }
  })

  for (const point of ["afterCreationClaim", "afterProvisioningClaim", "afterOwnerBindingSigned", "afterAuthorizationsSigned", "afterOwnerAuthority", "afterProjectIndexGenesis", "afterProjectIndexBridgeJournal", "afterDefaultCanvasRouteStage", "afterCanvasAuthorizationSigned", "afterDefaultCanvasGenesis", "afterDefaultCanvasRouteActivation", "beforeProtocolInstall"] as const) {
    test(`retries the same owner and bytes after ${point}`, async () => {
      let crash = true
      const fixture = await createFixture({
        provisionerFaults: { [point]: async () => { if (crash) { crash = false; throw new Error(point) } } },
      })
      await expect(fixture.provisioner.provisionNewProject(fixture.input)).rejects.toThrow(point)
      const result = await fixture.provisioner.provisionNewProject(fixture.input)
      expect(result.status).toBe("ready")
      expect(fixture.identityClaims.size).toBe(1)
      expect(fixture.bindingDigests.size).toBe(1)
    })
  }

  for (const point of ["afterClaim", "afterClosure", "afterDeviceRecord", "beforeActivePointer"] as const) {
    test(`retries across protocol-store cut point ${point}`, async () => {
      let crash = true
      const fixture = await createFixture({
        protocolFaults: { [point]: async () => { if (crash) { crash = false; throw new Error(point) } } },
      })
      await expect(fixture.provisioner.provisionNewProject(fixture.input)).rejects.toThrow(point)
      const result = await fixture.provisioner.provisionNewProject(fixture.input)
      expect(result.status).toBe("ready")
      expect(fixture.identityClaims.size).toBe(1)
    })
  }

  test("promotes only a verified unshared V10 closure and never rewrites V10 bytes", async () => {
    const fixture = await createFixture({ v10: verifiedV10() })
    const legacyPath = path.join(fixture.projectPrivateDirectory, "v10-frame.bin")
    const bytes = Uint8Array.from([0x43, 0x56, 0x58, 0x43, 0x4f, 0x4c, 0x4c, 0x32, 0xff])
    await fs.writeFile(legacyPath, bytes)
    const result = await fixture.provisioner.promoteVerifiedV10({
      projectId: fixture.input.projectId,
      projectEpoch: fixture.input.projectEpoch,
      protocolDigest: fixture.input.protocolDigest,
      promotionId: fixture.input.promotionId,
    })
    expect(result.status).toBe("ready")
    if (result.status === "ready") {
      expect(result.state.origin.kind).toBe("v10-r5-unshared")
      expect(result.state.bridges).toHaveLength(2)
      expect(result.state.bridges.every((bridge) => bridge.core.source.kind === "v10-r5")).toBe(true)
    }
    expect(new Uint8Array(await fs.readFile(legacyPath))).toEqual(bytes)
    expect(fixture.events).not.toContain("project-index")
    expect(fixture.events).not.toContain("canvas")
  })

  test("promotes an empty verified V10 Project by routing and publishing one default V3 Canvas", async () => {
    const fixture = await createFixture({ v10: verifiedEmptyV10() })
    const result = await fixture.provisioner.promoteVerifiedV10({
      projectId: fixture.input.projectId,
      projectEpoch: fixture.input.projectEpoch,
      protocolDigest: fixture.input.protocolDigest,
      promotionId: fixture.input.promotionId,
    })
    expect(result.status).toBe("ready")
    if (result.status === "ready") {
      expect(result.state.authorizations).toHaveLength(2)
      expect(result.state.bridges.map((bridge) => bridge.core.source.kind).sort()).toEqual(["new-project", "v10-r5"])
    }
    expect(fixture.events).toContain("route-stage")
    expect(fixture.events).toContain("authorization:canvas")
    expect(fixture.events).toContain("canvas")
    expect(fixture.events).toContain("route-activate")
    const opened = await fixture.ownerStore.open(fixture.input.projectId, fixture.input.projectEpoch)
    if (opened.status === "unshared") expect(opened.authority.authorizations).toHaveLength(2)
  })

  test("rejects shared and ambiguous V10 evidence before owner signing", async () => {
    for (const inspection of [{ status: "shared" }, { status: "ambiguous" }, { status: "invalid" }] as VerifiedV10PromotionInspectionV3[]) {
      const fixture = await createFixture({ v10: inspection })
      const result = await fixture.provisioner.promoteVerifiedV10({
        projectId: fixture.input.projectId,
        projectEpoch: fixture.input.projectEpoch,
        protocolDigest: fixture.input.protocolDigest,
        promotionId: fixture.input.promotionId,
      })
      expect(result.status).toBe("rejected")
      expect(fixture.events).toEqual([])
    }
  })

  test("device sharing tombstone dominates a verifier that claims V10 is unshared", async () => {
    const fixture = await createFixture({ v10: verifiedV10() })
    await fixture.ownerStore.recordSharingTombstone({
      projectId: fixture.input.projectId,
      projectEpoch: fixture.input.projectEpoch,
      sharingGeneration: "1",
      receiptDigest: digest("shared-receipt"),
    })
    const result = await fixture.provisioner.promoteVerifiedV10({
      projectId: fixture.input.projectId,
      projectEpoch: fixture.input.projectEpoch,
      protocolDigest: fixture.input.protocolDigest,
      promotionId: fixture.input.promotionId,
    })
    expect(result).toEqual({ status: "rejected", reason: "shared" })
    expect(fixture.events).toEqual([])
  })

  test("device V3 high-water rejects a restored pre-promotion Project before signing or genesis", async () => {
    const first = await createFixture()
    expect((await first.provisioner.provisionNewProject(first.input)).status).toBe("ready")
    await fs.rm(first.projectPrivateDirectory, { recursive: true })
    await fs.mkdir(first.projectPrivateDirectory)
    const restored = await createFixture({
      root: first.root,
      projectPrivateDirectory: first.projectPrivateDirectory,
      deviceProtocolDirectory: first.deviceProtocolDirectory,
      deviceAuthorityDirectory: first.deviceAuthorityDirectory,
    })
    const result = await restored.provisioner.provisionNewProject(restored.input)
    expect(result).toEqual({ status: "rejected", reason: "promotion-recovery-required" })
    expect(restored.events).toEqual([])
  })
})

async function createFixture(options: {
  root?: string
  projectPrivateDirectory?: string
  deviceProtocolDirectory?: string
  deviceAuthorityDirectory?: string
  provisionerFaults?: ConstructorParameters<typeof SuccessorLocalProjectProvisionerV3>[0]["faults"]
  protocolFaults?: ConstructorParameters<typeof NodeSuccessorProjectProtocolStateStoreV3>[0]["faults"]
  v10?: VerifiedV10PromotionInspectionV3
} = {}) {
  const root = options.root ?? await fs.mkdtemp(path.join(os.tmpdir(), "convax-v3-provisioner-"))
  if (!options.root) roots.push(root)
  const projectPrivateDirectory = options.projectPrivateDirectory ?? path.join(root, "project-private")
  const deviceProtocolDirectory = options.deviceProtocolDirectory ?? path.join(root, "device-protocol")
  const deviceAuthorityDirectory = options.deviceAuthorityDirectory ?? path.join(root, "device-authority")
  try { await fs.mkdir(projectPrivateDirectory) } catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error }
  const events: string[] = []
  const identityClaims = new Set<string>()
  const bindingDigests = new Set<string>()
  const signers = fakeSigners(events, identityClaims, bindingDigests)
  const protocolStore = new NodeSuccessorProjectProtocolStateStoreV3({ projectPrivateDirectory, deviceProtocolDirectory, faults: options.protocolFaults })
  const ownerStore = new NodeSuccessorLocalOwnerAuthorityStoreV3({ projectPrivateDirectory, deviceAuthorityDirectory })
  const input = newInput()
  const originalInstall = ownerStore.installUnshared.bind(ownerStore)
  ownerStore.installUnshared = async (authority) => { await originalInstall(authority); events.push("owner") }
  const provisioner = new SuccessorLocalProjectProvisionerV3({
    projectPrivateDirectory,
    ownerStore,
    protocolStore,
    signers,
    genesis: {
      async publishProjectIndexGenesis() { events.push("project-index"); return genesis("project-index") },
      async stageDefaultCanvasRoute(input) {
        expect(input.projectIndexBridge.core.scope.docKind).toBe("project-index")
        expect((await fs.stat(path.join(projectPrivateDirectory, "protocol-v3", "project-index-bridge-journal.jcs"))).isFile()).toBe(true)
        events.push("route-stage")
        return Object.freeze({ scope: input.expectedCanvasScope, predecessorFrameDigest: digest("default-route-frame"), acceptedFrontierDigest: digest("default-route-frontier") })
      },
      async publishDefaultCanvasGenesis(input) {
        expect(events).toContain("authorization:canvas")
        events.push("canvas")
        return genesis("canvas")
      },
      async activateDefaultCanvasRoute() { events.push("route-activate") },
    },
    v10: { async inspect() { return options.v10 ?? { status: "invalid" } } },
    faults: options.provisionerFaults,
  })
  return { root, projectPrivateDirectory, deviceProtocolDirectory, deviceAuthorityDirectory, protocolStore, ownerStore, provisioner, input, events, identityClaims, bindingDigests }
}

function fakeSigners(events: string[], claims: Set<string>, bindingDigests: Set<string>): SuccessorOwnerSigningPortV3 {
  const ownerPublicKey = parsePublicKeyV2(encodeBase64urlV2(Uint8Array.from({ length: 32 }, () => 2)))
  const identity = Object.freeze({
    ownerKeyId: structuredDigest("convax.local-project-owner-public-key/3", ownerPublicKey),
    ownerPublicKey,
    replicaId: parseReplicaIdV2("replica_00000001"),
    actorId: parseActorIdV2(encodeBase64urlV2(Uint8Array.from({ length: 32 }, () => 3))),
  })
  return {
    async resolveIdentity({ claimDigest }) { events.push("identity"); claims.add(claimDigest); return identity },
    async signBinding({ core }) {
      events.push("binding")
      const coreDigest = localProjectOwnerBindingCoreDigestV3(core)
      bindingDigests.add(coreDigest)
      return Object.freeze({ format: "convax.local-project-owner-binding/3", core, coreDigest, ownerSignature: signature() })
    },
    async signAuthorization({ core }) {
      events.push(`authorization:${core.scope.docKind}`)
      return Object.freeze({ format: "convax.local-owner-edit-authorization/3", core, coreDigest: localOwnerEditAuthorizationCoreDigestV3(core), ownerSignature: signature() })
    },
    async signBridge({ core }) {
      events.push(`bridge:${core.scope.docKind}`)
      return Object.freeze({ format: "convax.protocol-promotion-bridge/3", core, coreDigest: protocolPromotionBridgeCoreDigestV3(core), signerPublicKey: ownerPublicKey, signerSignature: signature() })
    },
  }
}

function newInput(): NewLocalProjectProvisionInputV3 {
  const projectId = `project_${"a".repeat(64)}` as never
  const projectEpoch = id(1)
  return Object.freeze({
    projectId,
    projectEpoch,
    protocolDigest: digest("protocol-v3"),
    projectIndexSchemaDigest: digest("project-index-schema"),
    canvasSchemaDigest: digest("canvas-schema"),
    promotionId: id(4),
    projectIndexScope: Object.freeze({ projectId, projectEpoch, docKind: "project-index", docId: "project-index", shardEpoch: id(2) }),
    defaultCanvasScope: Object.freeze({ projectId, projectEpoch, docKind: "canvas", docId: parseCanvasIdV2(`cv_${"b".repeat(64)}`), shardEpoch: id(3) }),
    defaultCanvasStageOperationId: id(4),
  })
}

function verifiedV10(): VerifiedV10PromotionInspectionV3 {
  const input = newInput()
  return Object.freeze({
    status: "verified-unshared",
    r5AuthorityManifestSha256: digest("r5-manifest"),
    verifiedLegacyClosureDigest: digest("legacy-closure"),
    documents: Object.freeze([
      source(input.projectIndexScope, "project-index"),
      source(input.defaultCanvasScope, "canvas"),
    ]),
  })
}

function verifiedEmptyV10(): VerifiedV10PromotionInspectionV3 {
  const input = newInput()
  return Object.freeze({
    status: "verified-unshared",
    r5AuthorityManifestSha256: digest("r5-manifest"),
    verifiedLegacyClosureDigest: digest("legacy-closure"),
    documents: Object.freeze([source(input.projectIndexScope, "project-index")]),
    emptyProjectDefaultCanvas: Object.freeze({
      scope: input.defaultCanvasScope,
      ownerSchemaDigest: input.canvasSchemaDigest,
      creationClaimDigest: digest("empty-v10-default-canvas-creation-claim"),
      stageOperationId: input.defaultCanvasStageOperationId,
    }),
  })
}

function source(scope: DocumentScopeV2, name: string) {
  return Object.freeze({ scope, ownerSchemaDigest: digest(`${name}:schema`), sourceHeadDigest: digest(`${name}:head`), sourceFrontierDigest: digest(`${name}:frontier`), authorizationProofDigest: digest(`${name}:proof`), durableCheckpointDigest: digest(`${name}:checkpoint`) })
}

function genesis(name: string) { return Object.freeze({ authorizationProofDigest: digest(`${name}:proof`), durableCheckpointDigest: digest(`${name}:checkpoint`), acceptedHeadDigest: digest(`${name}:head`), acceptedFrontierDigest: digest(`${name}:frontier`) }) }
function structuredDigest(domain: string, value: unknown): DigestV2 { const d = new TextEncoder().encode(domain); const b = encodeRestrictedJcsV2(value); const p = new Uint8Array(d.length + 1 + b.length); p.set(d); p.set(b, d.length + 1); return ordinarySha256V2(p) }
function signature() { return parseSignatureV2(encodeBase64urlV2(Uint8Array.from({ length: 64 }, (_, index) => index === 32 ? 1 : 0))) }
function id(value: number) { return parseId128V2(encodeBase64urlV2(Uint8Array.from({ length: 16 }, () => value))) }
function digest(value: string) { return ordinarySha256V2(new TextEncoder().encode(value)) }
