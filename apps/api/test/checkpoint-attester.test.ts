import { describe, expect, test } from "bun:test"
import {
  encodeBase64url,
  encodeCheckpointValidationCarrier,
  encodeRestrictedJcs,
  ordinarySha256,
  ownerCanonicalizerDescriptorDigest,
  parseCanvasId,
  parseId128,
  parseProjectId,
  parseUint32,
  parseUint64,
  createSelectedDocumentOwnerArtifactFactory,
  type CheckpointCarrierSectionKind,
  type CheckpointValidationCarrierIndex,
  type Digest,
  type OwnerProcessValueFactory,
  type SelectedDocumentOwnerArtifactDefinition,
} from "@convax/collaboration"
import {
  CHECKPOINT_ATTESTER_CONTENT_TYPE_V2,
  createIsolatedCheckpointAttesterV2Handler,
  type CheckpointAttesterAuditV2,
  type CheckpointAttesterEphemeralStoreV2,
  type CheckpointAttesterOptionsV2,
  type EphemeralCheckpointRequestV2,
  type EphemeralCheckpointSectionV2,
  type EphemeralCheckpointSectionWriterV2,
} from "../src"
import { loadApiTestProtocolAuthorityV2 } from "./authority-fixture"

const encoder = new TextEncoder()
const digest = (label: string) => ordinarySha256(encoder.encode(label))
const id = (byte: number) => parseId128(encodeBase64url(Uint8Array.from({ length: 16 }, () => byte)))
const signature = encodeBase64url(Uint8Array.from({ length: 64 }, () => 9)) as never

function carrierFixture(): Readonly<{
  carrier: Uint8Array
  index: CheckpointValidationCarrierIndex
}> {
  const values = [
    ["proposal-checkpoint", "proposal-checkpoint", "checkpoint"],
    ["proposal-snapshot", "proposal-snapshot", "snapshot"],
    ["validation-artifact", "canvas-artifact", "canvas"],
    ["validation-artifact", "kernel-artifact", "kernel"],
    ["validation-artifact", "control-artifact", "control"],
    ["validation-artifact", "project-artifact", "project"],
  ] as const satisfies readonly (readonly [CheckpointCarrierSectionKind, string, string])[]
  const sectionBytes = values.map(([, , body]) => encoder.encode(body))
  let offset = 0
  const sections = values.map(([kind, subject], ordinal) => {
    const bytes = sectionBytes[ordinal]!
    const section = {
      ordinal: parseUint32(String(ordinal)),
      kind,
      subjectDigest: digest(subject),
      byteOffset: parseUint64(String(offset)),
      byteLength: parseUint64(String(bytes.byteLength)),
      sha256: ordinarySha256(bytes),
    }
    offset += bytes.byteLength
    return section
  })
  const index: CheckpointValidationCarrierIndex = {
    format: "convax.checkpoint-validation-carrier-index/2",
    scope: {
      projectId: parseProjectId("project"),
      projectEpoch: id(1),
      docKind: "canvas",
      docId: parseCanvasId(`cv_${"3".repeat(64)}`),
      shardEpoch: id(2),
    },
    proposalCheckpointDigest: digest("proposal-checkpoint"),
    parentCheckpointDigests: [],
    suffixFrameDigests: [],
    validationArtifactSetDigest: digest("artifact-set"),
    sections,
    totalSectionBytes: String(offset) as never,
    protocolDigest: "de192e03a7466b631b1cefa50f745e22b1ed997f5ce23cbb9c9aea7e46b73bf5" as Digest,
  }
  return { carrier: encodeCheckpointValidationCarrier(index, sectionBytes), index }
}

function fakeOwnerDefinition(): SelectedDocumentOwnerArtifactDefinition<"canvas"> {
  const schemaDigest = "cb69352106c9fc61d28c6412b22b7efb453cd7b9db5324946c0d978772c54d36" as Digest
  const descriptor = Object.freeze({
    format: "convax.owner-canonicalizer-descriptor/2" as const,
    owner: "canvas" as const,
    ownerSchemaDigest: schemaDigest,
    canonicalStateFormat: "convax.canvas-canonical-state/2",
    canonicalStateCodec: "restricted-jcs-utf8" as const,
    exactBytePolicy: "parse-reencode-byte-equal" as const,
    unknownStatePolicy: "reject" as const,
  })
  return { owner: "canvas", createDefinitions(process: OwnerProcessValueFactory<"canvas">) { return { protocol: {
    owner: "canvas",
    schemaDigest,
    canonicalizerDescriptor: descriptor,
    canonicalizerDigest: ownerCanonicalizerDescriptorDigest(descriptor),
    decodeIntent: () => ({ kind: "noop" }),
    validateBase: () => process.wrapValidatedState(null),
    applyIntent: () => process.wrapApplyResult(null),
    validatePost: () => process.wrapValidatedState(null),
    canonicalStateBytes: () => encodeRestrictedJcs({ format: descriptor.canonicalStateFormat }),
    deriveActualWriteEvidence: () => { throw new Error("not used") },
  }, closure: {
    inspectIntent: () => ({ kind: "ordinary" }),
    discoverDependencies: () => ({ validationArtifacts: [], externalFacts: [] }),
    history: null,
  } } } }
}

class MemoryEphemeralStore implements CheckpointAttesterEphemeralStoreV2 {
  cleanupCalls = 0
  destroyCalls = 0
  destroyedBytes = 0

  async cleanupStale(): Promise<void> { this.cleanupCalls += 1 }

  async createRequest(): Promise<EphemeralCheckpointRequestV2> {
    const stored: Uint8Array[] = []
    let destroyed = false
    return {
      createSection: async (descriptor) => {
        const chunks: Uint8Array[] = []
        const writer: EphemeralCheckpointSectionWriterV2 = {
          write: async (bytes, signal) => {
            if (signal.aborted) throw new DOMException("cancelled", "AbortError")
            chunks.push(bytes.slice())
          },
          finish: async () => {
            const size = chunks.reduce((total, chunk) => total + chunk.byteLength, 0)
            const bytes = new Uint8Array(size)
            let offset = 0
            for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
            stored.push(bytes)
            const handle: EphemeralCheckpointSectionV2 = {
              descriptor,
              open: async () => {
                if (destroyed) throw new Error("destroyed")
                return new ReadableStream({ start(controller) { controller.enqueue(bytes.slice()); controller.close() } })
              },
            }
            return { handle, byteLength: parseUint64(String(bytes.byteLength)), sha256: ordinarySha256(bytes) }
          },
        }
        return writer
      },
      destroy: async () => {
        destroyed = true
        this.destroyCalls += 1
        for (const bytes of stored) { this.destroyedBytes += bytes.byteLength; bytes.fill(0) }
      },
    }
  }
}

async function options(overrides?: Partial<CheckpointAttesterOptionsV2>): Promise<Readonly<{
  value: CheckpointAttesterOptionsV2
  store: MemoryEphemeralStore
  audits: Parameters<CheckpointAttesterAuditV2["record"]>[0][]
  signCalls: { value: number }
}>> {
  const store = new MemoryEphemeralStore()
  const audits: Parameters<CheckpointAttesterAuditV2["record"]>[0][] = []
  const signCalls = { value: 0 }
  const protocolAuthority = await loadApiTestProtocolAuthorityV2()
  const ownerRuntime = createSelectedDocumentOwnerArtifactFactory(protocolAuthority, "canvas").createRuntime(fakeOwnerDefinition())
  if ("status" in ownerRuntime) throw new Error(ownerRuntime.code)
  const value: CheckpointAttesterOptionsV2 = {
    protocolAuthority,
    ephemeralStore: store,
    artifactResolver: {
      resolve: async ({ index, sections }) => {
        for (const section of sections) {
          const stream = await section.open(new AbortController().signal)
          await new Response(stream).arrayBuffer()
        }
        return {
          ownerRuntime,
          validationArtifactSetDigest: index.validationArtifactSetDigest,
          verifyCausalClosure: async () => ({
            parentCertificateDigests: [],
            computedFrontierDigest: digest("frontier"),
            actorHeadBoundaryDigest: digest("actor-heads"),
            stateVectorDigest: digest("state-vector"),
            canonicalStateDigest: digest("canonical-state"),
            fullUpdateDigest: digest("full-update"),
            trustBundleDigest: digest("trust-bundle"),
          }),
        }
      },
    },
    signer: {
      serviceKeyId: () => "content-key-1",
      signServiceDigest: async () => { signCalls.value += 1; return signature },
    },
    audit: { record: async (record) => { audits.push(record) } },
    createRequestId: () => "request-1",
    ...overrides,
  }
  return { value, store, audits, signCalls }
}

function request(carrier: Uint8Array, signal?: AbortSignal): Request {
  return new Request("https://attester.example.test/api/v2/attester/checkpoints", {
    method: "POST",
    headers: { "content-type": CHECKPOINT_ATTESTER_CONTENT_TYPE_V2 },
    body: carrier.slice().buffer as ArrayBuffer,
    signal,
  })
}

describe("isolated CVXCAR02 checkpoint attester", () => {
  test("streams into ephemeral sections, resolves exact owner authority, signs metadata only, then destroys bytes", async () => {
    const fixture = carrierFixture()
    const setup = await options()
    const handler = createIsolatedCheckpointAttesterV2Handler(setup.value)
    const response = await handler(request(fixture.carrier))

    expect(response.status).toBe(200)
    const certificate = await response.json() as Record<string, unknown>
    expect(certificate.format).toBe("convax.checkpoint-content-certificate/2")
    expect((certificate.core as Record<string, unknown>).checkpointDigest).toBe(fixture.index.proposalCheckpointDigest)
    expect((certificate.core as Record<string, unknown>).schemaDigest).toBe(setup.value.protocolAuthority.artifactDigests[0])
    expect(setup.signCalls.value).toBe(1)
    expect(setup.store.cleanupCalls).toBe(1)
    expect(setup.store.destroyCalls).toBe(1)
    expect(setup.store.destroyedBytes).toBeGreaterThan(0)
    expect(setup.audits).toHaveLength(1)
    expect(setup.audits[0]).toMatchObject({ outcome: "certified", cleanup: "destroyed", byteCount: String(fixture.carrier.byteLength) })
    expect(Object.keys(setup.audits[0]!)).not.toContain("payload")
  })

  test("fails closed without an artifact executable resolver and never signs", async () => {
    const fixture = carrierFixture()
    const setup = await options({ artifactResolver: { resolve: async () => "unavailable" } })
    const response = await createIsolatedCheckpointAttesterV2Handler(setup.value)(request(fixture.carrier))
    expect(response.status).toBe(503)
    expect(await response.json()).toMatchObject({ code: "validation-artifact-authority-unavailable" })
    expect(setup.signCalls.value).toBe(0)
    expect(setup.store.destroyCalls).toBe(1)
    expect(setup.audits[0]).toMatchObject({ outcome: "unavailable", cleanup: "destroyed" })
  })

  test("rejects a structural runtime copy before validation or signing", async () => {
    const fixture = carrierFixture()
    const base = await options()
    const resolved = await base.value.artifactResolver.resolve({ index: fixture.index, sections: [], signal: new AbortController().signal })
    if (typeof resolved === "string") throw new Error(resolved)
    let verificationCalls = 0
    const setup = await options({
      artifactResolver: {
        resolve: async () => ({
          ...resolved,
          ownerRuntime: { ...resolved.ownerRuntime },
          verifyCausalClosure: async (input) => { verificationCalls += 1; return resolved.verifyCausalClosure(input) },
        }),
      },
    })
    const response = await createIsolatedCheckpointAttesterV2Handler(setup.value)(request(fixture.carrier))
    expect(response.status).toBe(503)
    expect(await response.json()).toMatchObject({ code: "selected-owner-runtime-unavailable" })
    expect(verificationCalls).toBe(0)
    expect(setup.signCalls.value).toBe(0)
    expect(setup.store.destroyCalls).toBe(1)
  })

  test("rejects a corrupt section before resolver execution and cleans ephemeral bytes", async () => {
    const fixture = carrierFixture()
    const corrupt = fixture.carrier.slice()
    corrupt[corrupt.byteLength - 1] ^= 1
    let resolverCalls = 0
    const setup = await options({ artifactResolver: { resolve: async () => { resolverCalls += 1; return "rejected" } } })
    const response = await createIsolatedCheckpointAttesterV2Handler(setup.value)(request(corrupt))
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ code: "carrier-section-hash-mismatch" })
    expect(resolverCalls).toBe(0)
    expect(setup.signCalls.value).toBe(0)
    expect(setup.store.destroyCalls).toBe(1)
  })

  test("cancellation interrupts a stalled stream, signs nothing and destroys the partial request", async () => {
    const fixture = carrierFixture()
    const controller = new AbortController()
    const stalled = new ReadableStream<Uint8Array>({
      start(stream) {
        stream.enqueue(fixture.carrier.subarray(0, fixture.carrier.byteLength - 1))
      },
    })
    const setup = await options()
    const pending = createIsolatedCheckpointAttesterV2Handler(setup.value)(new Request("https://attester.example.test/api/v2/attester/checkpoints", {
      method: "POST",
      headers: { "content-type": CHECKPOINT_ATTESTER_CONTENT_TYPE_V2 },
      body: stalled,
      signal: controller.signal,
    }))
    await Promise.resolve()
    controller.abort()
    const response = await pending
    expect(response.status).toBe(408)
    expect(await response.json()).toMatchObject({ code: "attestation-cancelled" })
    expect(setup.signCalls.value).toBe(0)
    expect(setup.store.destroyCalls).toBe(1)
    expect(setup.audits[0]).toMatchObject({ outcome: "cancelled", cleanup: "destroyed" })
  })

  test("keeps the attester absent from the ordinary router contract", async () => {
    const fixture = carrierFixture()
    const setup = await options()
    const handler = createIsolatedCheckpointAttesterV2Handler(setup.value)
    expect((await handler(new Request("https://attester.example.test/api/v2/projects/project/checkpoint-certificates", { method: "POST", body: fixture.carrier.slice().buffer as ArrayBuffer }))).status).toBe(404)
  })
})
