import { describe, expect, test } from "bun:test"
import * as Y from "yjs"
import { ownerCanonicalizerDescriptorDigest } from "./canonicalizer"
import { parseDigest } from "./codecs"
import { PROTOCOL_SCHEMA_ARTIFACTS } from "./constants"
import type { OwnerProcessValueFactory, SelectedDocumentOwnerArtifactDefinition } from "./contracts"
import { encodeRestrictedJcs } from "./jcs"
import {
  armOwnerCandidateTransactionCapture,
  assertDocumentOwnerRuntime,
  assertOwnerExternalFactPort,
  createSelectedDocumentOwnerArtifactFactory,
  consumeOwnerCanonicalJcsEvidence,
  consumeOwnerStateCommitmentDigest,
  installOwnerValidatedPostCache,
  issueAcceptedReplicaApplyEvidence,
} from "./owner-runtime"
import * as publicSurface from "./index"
import { loadVerifiedTestAuthority } from "./authority.test-support"

const SCHEMA = parseDigest(PROTOCOL_SCHEMA_ARTIFACTS[0].artifactDigest)
const descriptor = Object.freeze({
  format: "convax.owner-canonicalizer-descriptor" as const,
  owner: "canvas" as const,
  ownerSchemaDigest: SCHEMA,
  canonicalStateFormat: "convax.canvas-owner-runtime-test",
  canonicalStateCodec: "restricted-jcs-utf8" as const,
  exactBytePolicy: "parse-reencode-byte-equal" as const,
  unknownStatePolicy: "reject" as const,
  stateCommitment: Object.freeze({
    format: "convax.owner-state-commitment-descriptor" as const,
    commitmentCodec: "sha256-merkle-patricia-v1" as const,
    canonicalKeyPathPolicy: "nfc-utf8-no-nul-bounded-v1" as const,
    maxCanonicalNameUtf8Bytes: "128" as const,
    maxCanonicalKeyUtf8Bytes: "1024" as const,
    scalarNames: Object.freeze(["format"]),
    collectionNames: Object.freeze([]),
  }),
})
const canonicalizerDigest = ownerCanonicalizerDescriptorDigest(descriptor)

function definition(
  capture?: (values: OwnerProcessValueFactory<"canvas">) => void,
  borrowedValues?: OwnerProcessValueFactory<"canvas">,
): SelectedDocumentOwnerArtifactDefinition<"canvas"> {
  return {
    owner: "canvas",
    createDefinitions(values) {
      capture?.(values)
      const process = borrowedValues ?? values
      return {
        protocol: {
          owner: "canvas",
          schemaDigest: SCHEMA,
          canonicalizerDescriptor: descriptor,
          canonicalizerDigest,
          decodeIntent: () => ({ kind: "noop" }),
          validateBase(document) {
            const state = process.wrapValidatedState(null)
            const commitment = process.stateCommitment.build({
              descriptor: descriptor.stateCommitment,
              scalars: [{ name: "format", value: descriptor.canonicalStateFormat }],
              collections: [],
            })
            return process.bindStateCommitment(document, state, commitment)
          },
          applyIntent: () => process.wrapApplyResult(null),
          validatePost(_base, document) {
            const state = process.wrapValidatedState(null)
            const commitment = process.stateCommitment.build({
              descriptor: descriptor.stateCommitment,
              scalars: [{ name: "format", value: descriptor.canonicalStateFormat }],
              collections: [],
            })
            return process.bindStateCommitment(document, state, commitment)
          },
          canonicalStateBytes: () => encodeRestrictedJcs({ format: descriptor.canonicalStateFormat }),
          deriveActualWriteEvidence: () => {
            throw new Error("not used")
          },
        },
        closure: {
          inspectIntent: () => ({ kind: "ordinary" }),
          discoverDependencies: () => ({ validationArtifacts: [], externalFacts: [] }),
          history: null,
        },
      }
    },
  }
}

describe("Current document-owner runtime", () => {
  test("publishes the one live commitment consumer through the package root", async () => {
    const authority = await loadVerifiedTestAuthority()
    const runtime = createSelectedDocumentOwnerArtifactFactory(authority, "canvas").createRuntime(definition())
    if ("status" in runtime) throw new Error(runtime.code)
    const document = new Y.Doc()
    try {
      const state = runtime.protocolPort.validateBase(document)
      if (typeof state === "string") throw new Error("base unavailable")
      expect(publicSurface.consumeOwnerStateCommitmentDigest).toBe(consumeOwnerStateCommitmentDigest)
      expect(consumeOwnerStateCommitmentDigest(runtime, document, state)).toMatch(/^[0-9a-f]{64}$/)
      expect(consumeOwnerStateCommitmentDigest(runtime, document, state)).toBeNull()
    } finally {
      document.destroy()
    }
  })

  test("binds canonical evidence to one runtime, document generation, and consumption", async () => {
    const authority = await loadVerifiedTestAuthority()
    let values: OwnerProcessValueFactory<"canvas"> | undefined
    const runtime = createSelectedDocumentOwnerArtifactFactory(authority, "canvas").createRuntime(definition((captured) => { values = captured }))
    if ("status" in runtime || !values) throw new Error("runtime unavailable")
    const document = new Y.Doc()
    const other = new Y.Doc()
    try {
      const base = runtime.protocolPort.validateBase(document)
      if (typeof base === "string") throw new Error("base unavailable")
      armOwnerCandidateTransactionCapture(runtime, { base, candidate: document, context: {} as never })
      document.transact(() => { document.getMap("state").set("value", 1) })
      const state = values.wrapValidatedState(null)
      const evidence = values.canonicalJcs.encodeEvidence({ format: descriptor.canonicalStateFormat })
      values.bindCanonicalJcsEvidence(document, state, evidence)
      expect(consumeOwnerCanonicalJcsEvidence(runtime, other, state)).toBeNull()
      expect(consumeOwnerCanonicalJcsEvidence(runtime, document, state)).toEqual(encodeRestrictedJcs({ format: descriptor.canonicalStateFormat }))
      expect(consumeOwnerCanonicalJcsEvidence(runtime, document, state)).toBeNull()

      const stale = values.wrapValidatedState(null)
      values.bindCanonicalJcsEvidence(document, stale, evidence)
      document.transact(() => { document.getMap("state").set("value", 2) })
      expect(consumeOwnerCanonicalJcsEvidence(runtime, document, stale)).toBeNull()
    } finally {
      document.destroy()
      other.destroy()
    }
  })

  test("mints one live identity closure and rejects structural runtime copies", async () => {
    const authority = await loadVerifiedTestAuthority()
    const runtime = createSelectedDocumentOwnerArtifactFactory(authority, "canvas").createRuntime(definition())
    if ("status" in runtime) throw new Error(runtime.code)
    expect(runtime.artifactDigest).toBe(SCHEMA)
    expect(runtime.closurePort.protocolPort).toBe(runtime.protocolPort)
    expect(() => assertDocumentOwnerRuntime(runtime, authority)).not.toThrow()
    expect(() => assertDocumentOwnerRuntime({ ...runtime }, authority)).toThrow("live selected")
  })

  test("rejects process values borrowed from a different selected factory", async () => {
    const authority = await loadVerifiedTestAuthority()
    let firstValues: OwnerProcessValueFactory<"canvas"> | undefined
    const first = createSelectedDocumentOwnerArtifactFactory(authority, "canvas").createRuntime(definition((value) => { firstValues = value }))
    if ("status" in first || !firstValues) throw new Error("first runtime unavailable")
    const second = createSelectedDocumentOwnerArtifactFactory(authority, "canvas").createRuntime(definition(undefined, firstValues))
    if ("status" in second) throw new Error(second.code)
    const document = new Y.Doc()
    try {
      expect(() => second.protocolPort.validateBase(document)).toThrow("exact active validated state")
    } finally {
      document.destroy()
    }
  })

  test("rejects stale-factory and wrong-owner state brands before owner apply", async () => {
    const authority = await loadVerifiedTestAuthority()
    const first = createSelectedDocumentOwnerArtifactFactory(authority, "canvas").createRuntime(definition())
    const second = createSelectedDocumentOwnerArtifactFactory(authority, "canvas").createRuntime(definition())
    if ("status" in first || "status" in second) throw new Error("runtime unavailable")
    const document = new Y.Doc()
    try {
      const stale = first.protocolPort.validateBase(document)
      if (typeof stale === "string") throw new Error("base unavailable")
      expect(() => second.protocolPort.applyIntent(stale, document, {} as never, {}, {} as never)).toThrow("another runtime")
      expect(() => second.protocolPort.applyIntent(
        Object.freeze({ owner: "project-index", value: null }) as never,
        document,
        {} as never,
        {},
        {} as never,
      )).toThrow("structural, stale or belongs to another runtime")
    } finally {
      document.destroy()
    }
  })

  test("checks the selected factory brand before invoking the post-cache hook", async () => {
    const authority = await loadVerifiedTestAuthority()
    let installs = 0
    const selected = definition()
    const first = createSelectedDocumentOwnerArtifactFactory(authority, "canvas").createRuntime({
      ...selected,
      installValidatedPostCache: () => { installs += 1 },
    })
    const second = createSelectedDocumentOwnerArtifactFactory(authority, "canvas").createRuntime(definition())
    if ("status" in first || "status" in second) throw new Error("runtime unavailable")
    const source = new Y.Doc()
    const target = new Y.Doc()
    try {
      const own = first.protocolPort.validateBase(source)
      const stale = second.protocolPort.validateBase(source)
      if (typeof own === "string" || typeof stale === "string") throw new Error("base unavailable")
      const applyEvidence = issueAcceptedReplicaApplyEvidence(first, { scopeDigest: SCHEMA, target, state: own, canonicalStateDigest: SCHEMA, materializationDigest: SCHEMA, postStateVectorDigest: SCHEMA, yjsUpdateDigest: SCHEMA, generation: 1 })
      const acceleration = { applyEvidence, scopeDigest: SCHEMA, materializationDigest: SCHEMA, postStateVectorDigest: SCHEMA, yjsUpdateDigest: SCHEMA }
      installOwnerValidatedPostCache(first, { scope: {} as never, source, target, state: own, canonicalStateDigest: SCHEMA, durableHeadDigest: SCHEMA, ...acceleration })
      expect(installs).toBe(1)
      expect(() => installOwnerValidatedPostCache(first, { scope: {} as never, source, target, state: stale, canonicalStateDigest: SCHEMA, durableHeadDigest: SCHEMA, ...acceleration })).toThrow(
        "another runtime",
      )
      expect(installs).toBe(1)
      expect(() => installOwnerValidatedPostCache({ ...first } as never, { scope: {} as never, source, target, state: own, canonicalStateDigest: SCHEMA, durableHeadDigest: SCHEMA, ...acceleration })).toThrow(
        "live selected",
      )
      expect("installValidatedPostCache" in first).toBe(false)
      expect("installOwnerValidatedPostCache" in publicSurface).toBe(false)
      expect("readOwnerCertifiedCanonicalDigest" in publicSurface).toBe(false)
    } finally {
      source.destroy()
      target.destroy()
    }
  })

  test("checks live runtime and exact factory state before arming candidate capture", async () => {
    const authority = await loadVerifiedTestAuthority()
    let arms = 0
    const selected = definition()
    const first = createSelectedDocumentOwnerArtifactFactory(authority, "canvas").createRuntime({
      ...selected,
      armCandidateTransactionCapture: () => { arms += 1 },
    })
    const second = createSelectedDocumentOwnerArtifactFactory(authority, "canvas").createRuntime(definition())
    if ("status" in first || "status" in second) throw new Error("runtime unavailable")
    const candidate = new Y.Doc()
    try {
      const own = first.protocolPort.validateBase(candidate)
      const stale = second.protocolPort.validateBase(candidate)
      if (typeof own === "string" || typeof stale === "string") throw new Error("base unavailable")
      armOwnerCandidateTransactionCapture(first, { base: own, candidate, context: {} as never })
      expect(arms).toBe(1)
      expect(() => armOwnerCandidateTransactionCapture(first, { base: stale, candidate, context: {} as never })).toThrow("another runtime")
      expect(() => armOwnerCandidateTransactionCapture({ ...first } as never, { base: own, candidate, context: {} as never })).toThrow("live selected")
      expect(arms).toBe(1)
      expect("armOwnerCandidateTransactionCapture" in publicSurface).toBe(false)
      expect("armCandidateTransactionCapture" in first).toBe(false)
    } finally {
      candidate.destroy()
    }
  })

  test("creates attempt-scoped fact ports and rejects wrong-owner and structural ports", async () => {
    const authority = await loadVerifiedTestAuthority()
    const runtime = createSelectedDocumentOwnerArtifactFactory(authority, "canvas").createRuntime(definition())
    if ("status" in runtime) throw new Error(runtime.code)
    const wrongOwner = runtime.externalFactPortFactory.createAttemptPort({
      declared: { validationArtifacts: [], externalFacts: [] },
      resolver: {
        owner: "project-index" as never,
        resolveArtifact: (ref) => ({ status: "pending", ref }),
        resolveFact: (requirement) => ({ status: "pending", requirement }),
      },
    })
    expect(wrongOwner).toEqual({ status: "rejected", code: "wrong-owner" })
    const created = runtime.externalFactPortFactory.createAttemptPort({
      declared: { validationArtifacts: [], externalFacts: [] },
      resolver: {
        owner: "canvas",
        resolveArtifact: (ref) => ({ status: "pending", ref }),
        resolveFact: (requirement) => ({ status: "pending", requirement }),
      },
    })
    if (created.status === "rejected") throw new Error(created.code)
    expect(() => assertOwnerExternalFactPort(created.port, runtime)).not.toThrow()
    expect(() => assertOwnerExternalFactPort({ ...created.port }, runtime)).toThrow("live owner external-fact")
  })
})
