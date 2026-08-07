import { describe, expect, test } from "bun:test"
import * as Y from "yjs"
import type { CurrentProtocolAuthority } from "./authority"
import { ownerCanonicalizerDescriptorDigest } from "./canonicalizer"
import { causalFrontierDigest } from "./causal"
import {
  encodeBase64url,
  parseActorId,
  parseCanvasId,
  parseDigest,
  parseId128,
  parseMemberId,
  parsePublicKey,
  parseProjectId,
  parseReplicaId,
  parseSignature,
  parseUint64,
  type Digest,
  type Id128,
  type StateVector,
} from "./codecs"
import { PROTOCOL_SCHEMA_ARTIFACTS } from "./constants"
import type {
  DecodedCausalEditFrame,
  DocumentOwnerRuntime,
  DocumentScope,
  FrameObjectRef,
  OwnerExternalFactPort,
  SelectedDocumentOwnerArtifactDefinition,
} from "./contracts"
import { canonicalStateDigest, ordinarySha256 } from "./digest"
import { decodeCausalEditFrame } from "./frame"
import { decodeRestrictedJcs, encodeRestrictedJcs } from "./jcs"
import { CollaborationKernel, type LocalIntentRequest } from "./kernel"
import type { CollaborationLatencyDiagnostic, CollaborationLatencyDiagnosticsPort } from "./latency-diagnostics"
import { createSelectedDocumentOwnerArtifactFactory } from "./owner-runtime"
import type {
  AcceptedHeadMaterializationEvidence,
  AcceptedHeadView,
  CollaborationKernelPorts,
  CollaborationPersistencePort,
  LocalFrameAuthority,
  OperationLookup,
} from "./ports"
import { ACCEPTED_FRAME_ORIGIN, encodeFullUpdate, encodeStateVector } from "./yjs-codec"
import { loadVerifiedTestAuthority } from "./authority.test-support"

const encoder = new TextEncoder()
const factPortFactories = new WeakMap<CollaborationKernel, () => OwnerExternalFactPort<"canvas">>()
const ID = parseId128(encodeBase64url(new Uint8Array(16)))
const ACTOR = parseActorId(encodeBase64url(Uint8Array.from({ length: 32 }, () => 7)))
const MEMBER = parseMemberId(encodeBase64url(Uint8Array.from({ length: 16 }, () => 8)))
const REPLICA = parseReplicaId("replica_0000002a")
const PUBLIC_KEY = parsePublicKey(encodeBase64url(Uint8Array.from({ length: 32 }, () => 2)))
const SIGNATURE = parseSignature(
  encodeBase64url(Uint8Array.from({ length: 64 }, (_, index) => (index < 32 ? 3 : index === 32 ? 1 : 0))),
)
const SCHEMA = parseDigest(PROTOCOL_SCHEMA_ARTIFACTS[0].artifactDigest)
const CANONICAL_STATE_FORMAT = "convax.canvas-canonical-state" as const
const CANONICALIZER_DESCRIPTOR = Object.freeze({
  format: "convax.owner-canonicalizer-descriptor" as const,
  owner: "canvas" as const,
  ownerSchemaDigest: SCHEMA,
  canonicalStateFormat: CANONICAL_STATE_FORMAT,
  canonicalStateCodec: "restricted-jcs-utf8" as const,
  exactBytePolicy: "parse-reencode-byte-equal" as const,
  unknownStatePolicy: "reject" as const,
})
const CANONICALIZER = ownerCanonicalizerDescriptorDigest(CANONICALIZER_DESCRIPTOR)
const D1 = ordinarySha256(encoder.encode("membership"))
const D2 = ordinarySha256(encoder.encode("actor-credential"))
const D3 = ordinarySha256(encoder.encode("edit-authorization"))
const SCOPE: DocumentScope = Object.freeze({
  projectId: parseProjectId("project"),
  projectEpoch: ID,
  docKind: "canvas",
  docId: parseCanvasId(`cv_${"2".repeat(64)}`),
  shardEpoch: ID,
})

function authority(): Promise<CurrentProtocolAuthority> {
  return loadVerifiedTestAuthority()
}

function ownerDefinition(
  overrides?: Partial<ReturnType<SelectedDocumentOwnerArtifactDefinition<"canvas">["createDefinitions"]>>,
): SelectedDocumentOwnerArtifactDefinition<"canvas"> {
  return {
    owner: "canvas",
    createDefinitions(processValues) {
      const protocol = {
        owner: "canvas" as const,
        schemaDigest: SCHEMA,
        canonicalizerDescriptor: CANONICALIZER_DESCRIPTOR,
        canonicalizerDigest: CANONICALIZER,
        decodeIntent(exactJcs: Uint8Array) {
          const value = decodeRestrictedJcs(exactJcs)
          return typeof value === "object" && value !== null && (value as { kind?: unknown }).kind === "set"
            ? value
            : ("rejected" as const)
        },
        validateBase(document: Y.Doc) {
          const keys = [...document.getMap("root").keys()]
          return keys.every((key) => key === "value")
            ? processValues.wrapValidatedState(document.getMap("root").toJSON())
            : ("rejected" as const)
        },
        applyIntent(_base: unknown, candidate: Y.Doc, context: { intentDigest: typeof D1 }, intent: unknown) {
          const value = (intent as { value?: unknown }).value
          if (typeof value !== "string") return "rejected" as const
          candidate.getMap("root").set("value", value)
          return processValues.wrapApplyResult({ value, intentDigest: context.intentDigest })
        },
        validatePost(_base: unknown, candidate: Y.Doc) {
          return typeof candidate.getMap("root").get("value") === "string"
            ? processValues.wrapValidatedState(candidate.getMap("root").toJSON())
            : ("rejected" as const)
        },
        canonicalStateBytes(document: Y.Doc) {
          return canonicalStateBytes(document)
        },
        deriveActualWriteEvidence(result: { value: unknown }) {
          const { value, intentDigest } = result.value as { value: string; intentDigest: typeof D1 }
          return {
            format: "convax.actual-write-evidence" as const,
            scope: SCOPE,
            owner: "canvas" as const,
            ownerSchemaDigest: SCHEMA,
            intentDigest,
            changedPaths: ["root/value"],
            writes: [
              {
                entityKind: "root",
                entityId: "root",
                field: "value",
                valueDigest: ordinarySha256(encoder.encode(value)),
              },
            ],
          }
        },
      }
      const closure = {
        inspectIntent: () => ({ kind: "ordinary" as const }),
        discoverDependencies: () => ({ validationArtifacts: [], externalFacts: [] }),
        history: null,
      }
      return { protocol: overrides?.protocol ?? protocol, closure: overrides?.closure ?? closure }
    },
  }
}

class MemoryPersistence implements CollaborationPersistencePort {
  readonly events: string[] = []
  readonly objects = new Map<string, Uint8Array>()
  readonly accepted = new Map<string, FrameObjectRef>()
  readonly refsByDigest = new Map<string, FrameObjectRef>()
  failAt: "object" | "outbox" | "journal" | "head" | null = null
  stale = false
  throwAfterHeadCommit = false
  mutateMaterializationDuringJournal = false
  fastHeadVerification = false
  headLoadCount = 0
  headVerificationCount = 0
  materializationEvidence: AcceptedHeadMaterializationEvidence | undefined
  private pendingJournal: FrameObjectRef | null = null
  head: AcceptedHeadView

  constructor() {
    this.head = emptyHead()
  }

  async loadReplicaHead(): Promise<AcceptedHeadView> {
    this.headLoadCount += 1
    return this.head
  }
  async verifyReplicaHeadCurrent(input: {
    readonly expectedHeadDigest: Digest
    readonly expectedFrontierDigest: Digest
  }): Promise<"verified" | "reload-required"> {
    this.headVerificationCount += 1
    if (!this.fastHeadVerification) return "reload-required"
    return input.expectedHeadDigest === this.head.headDigest && input.expectedFrontierDigest === this.head.frontierDigest
      ? "verified"
      : "reload-required"
  }
  async putImmutableFrame(ref: FrameObjectRef, value: Uint8Array): Promise<void> {
    this.events.push("object")
    if (this.failAt === "object") throw new Error("object crash")
    this.objects.set(ref.frameDigest, Uint8Array.from(value))
    this.refsByDigest.set(ref.frameDigest, ref)
  }
  async putReplicationOutboxRef(): Promise<void> {
    this.events.push("outbox")
    if (this.failAt === "outbox") throw new Error("outbox crash")
  }
  async appendFrameJournal(ref: FrameObjectRef, materialization?: AcceptedHeadMaterializationEvidence) {
    this.events.push("journal")
    if (this.failAt === "journal") throw new Error("journal crash")
    this.pendingJournal = ref
    this.materializationEvidence = materialization
    if (this.mutateMaterializationDuringJournal && materialization) {
      materialization.fullUpdate.fill(0xff)
      materialization.stateVector.fill(0xff)
    }
    return { ref, journalRecordDigest: ordinarySha256(encoder.encode(`journal:${ref.frameDigest}`)) }
  }
  async compareAndCommitReplicaHead(input: Parameters<CollaborationPersistencePort["compareAndCommitReplicaHead"]>[0]) {
    this.events.push("head")
    if (this.failAt === "head") throw new Error("head crash")
    if (this.stale) {
      return {
        status: "quarantined" as const,
        evidence: {
          ref: input.ref,
          journalRecordDigest: input.journal.journalRecordDigest,
          expectedReplicaHeadRecordDigest: input.expectedReplicaHeadRecordDigest,
          observedReplicaHeadRecordDigest: ordinarySha256(encoder.encode("other-head")),
          quarantineCommitRecordDigest: ordinarySha256(encoder.encode("quarantine")),
          shardDispositionHeadRecordDigest: this.head.headDigest,
        },
      }
    }
    const ref = this.pendingJournal!
    const headDigest = ordinarySha256(encoder.encode(`head:${ref.frameDigest}`))
    this.accepted.set(`${ref.actorId}:${ref.operationId}`, ref)
    const frame = decodeCausalEditFrame(await authority(), this.objects.get(ref.frameDigest)!)
    const document = new Y.Doc()
    Y.applyUpdate(document, this.head.fullUpdate)
    Y.applyUpdate(document, frame.sections.yjsUpdate)
    const causalHead = headRef(frame)
    const frontier = Object.freeze({ format: "convax.causal-frontier" as const, heads: Object.freeze([causalHead]) })
    this.head = {
      ...this.head,
      headDigest,
      frontier,
      frontierDigest: causalFrontierDigest(frontier),
      actorHeads: { format: "convax.replica-actor-head-set", scope: SCOPE, heads: [causalHead] },
      fullUpdate: encodeFullUpdate(document),
      stateVector: encodeStateVector(document),
      canonicalStateDigest: canonicalStateDigest(SCHEMA, canonicalStateBytes(document)),
    }
    document.destroy()
    if (this.throwAfterHeadCommit) throw new Error("post-head response loss")
    return {
      status: "committed" as const,
      evidence: {
        ref,
        journalRecordDigest: input.journal.journalRecordDigest,
        expectedReplicaHeadRecordDigest: input.expectedReplicaHeadRecordDigest,
        resultingReplicaHeadRecordDigest: headDigest,
        resultingFrontierDigest: input.resultingFrontierDigest,
      },
    }
  }
  async isReachableFromAcceptedHead(ref: FrameObjectRef): Promise<boolean> {
    return this.accepted.has(`${ref.actorId}:${ref.operationId}`)
  }
  async lookupOperation(actorId: string, operationId: string): Promise<OperationLookup> {
    const ref = this.accepted.get(`${actorId}:${operationId}`)
    if (ref) return { status: "accepted", ref, bytes: this.objects.get(ref.frameDigest)! }
    const recovery = [...this.refsByDigest.values()].find(
      (item) => item.actorId === actorId && item.operationId === operationId,
    )
    return recovery
      ? { status: "object-only-recovery", ref: recovery, bytes: this.objects.get(recovery.frameDigest)! }
      : { status: "absent" }
  }
  async scanDurableReferences(frameDigest: string) {
    return { complete: true, reachable: this.refsByDigest.has(frameDigest) }
  }
  async quarantineExactObject(): Promise<void> {
    this.events.push("quarantine")
  }
}

function emptyHead(): AcceptedHeadView {
  const doc = new Y.Doc()
  const frontier = Object.freeze({ format: "convax.causal-frontier" as const, heads: Object.freeze([]) })
  const result: AcceptedHeadView = Object.freeze({
    scope: SCOPE,
    headDigest: ordinarySha256(encoder.encode("genesis-head")),
    frontier,
    frontierDigest: causalFrontierDigest(frontier),
    actorHeads: Object.freeze({ format: "convax.replica-actor-head-set", scope: SCOPE, heads: Object.freeze([]) }),
    fullUpdate: encodeFullUpdate(doc),
    stateVector: encodeStateVector(doc),
    canonicalStateDigest: canonicalStateDigest(SCHEMA, canonicalStateBytes(doc)),
  })
  doc.destroy()
  return result
}

function ports(persistence: MemoryPersistence): CollaborationKernelPorts {
  return {
    createDocument: () => new Y.Doc(),
    persistence,
    localAuthority: {
      actorId: ACTOR,
      async prepareFinalFrameAuthority(): Promise<LocalFrameAuthority> {
        const last = [...persistence.accepted.values()].at(-1)
        return {
          actorId: ACTOR,
          actorSequence: parseUint64(last ? String(BigInt(last.actorSequence) + 1n) : "1"),
          predecessorFrameDigest: last?.frameDigest ?? null,
          signerAuthority: {
            kind: "team-replica",
            memberId: MEMBER,
            replicaId: REPLICA,
            actorId: ACTOR,
            memberAuthorizationEpoch: ID,
            replicaAuthorizationEpoch: ID,
            membershipSnapshotDigest: D1,
            replicaActorCredentialCoreDigest: D2,
            replicaEditAuthorizationCoreDigest: D3,
          },
          dependencies: [
            { kind: "membership-snapshot", digest: D1 },
            { kind: "replica-actor-credential", digest: D2 },
            { kind: "replica-edit-authorization", digest: D3 },
          ],
          validationArtifacts: requiredValidationArtifacts(),
          signer: { sign: async () => SIGNATURE },
        }
      },
    },
    incomingAuthority: { verifyFrameAuthority: async () => ({ replicaPublicKey: PUBLIC_KEY }) },
    incomingFacts: { resolve: async () => ({ status: "rejected" }) },
    exactBaseResolver: { reconstructExactBase: async () => "pending" },
    causalClosure: { contains: () => false },
    pendingInbox: { retainExactFrame: async () => "retained" },
  }
}

async function openKernel(
  persistence: MemoryPersistence,
  override?: Partial<CollaborationKernelPorts>,
  projection?: string[],
  ownerRuntime?: DocumentOwnerRuntime<"canvas">,
  diagnostics?: CollaborationLatencyDiagnosticsPort,
) {
  const base = ports(persistence)
  const selectedAuthority = await authority()
  const runtimeResult =
    ownerRuntime ??
    createSelectedDocumentOwnerArtifactFactory(selectedAuthority, "canvas").createRuntime(ownerDefinition())
  if ("status" in runtimeResult) throw new Error(`owner runtime rejected: ${runtimeResult.code}`)
  const createFacts = () => emptyFacts(runtimeResult)
  const kernel = await CollaborationKernel.open({
    authority: selectedAuthority,
    scope: SCOPE,
    owner: runtimeResult,
    ports: {
      ...base,
      incomingFacts: { resolve: async () => ({ status: "resolved", port: createFacts() }) },
      ...override,
    },
    signatureVerifier: { verify: async () => true },
    projection: projection ? { publish: ({ frameDigest }) => projection.push(frameDigest) } : undefined,
    diagnostics,
  })
  factPortFactories.set(kernel, createFacts)
  return kernel
}

function emptyFacts(runtime: DocumentOwnerRuntime<"canvas">): OwnerExternalFactPort<"canvas"> {
  const facts = runtime.externalFactPortFactory.createAttemptPort({
    declared: { validationArtifacts: [], externalFacts: [] },
    resolver: {
      owner: "canvas",
      resolveArtifact: (ref) => ({ status: "pending", ref }),
      resolveFact: (requirement) => ({ status: "pending", requirement }),
    },
  })
  if (facts.status === "rejected") throw new Error(`fact port rejected: ${facts.code}`)
  return facts.port
}

describe("Current protocol owner boundary", () => {
  test("rejects descriptor field tampering before constructing a Y.Doc", async () => {
    const selectedAuthority = await authority()
    const definition = ownerDefinition()
    const tampered = {
      ...definition,
      createDefinitions(values: Parameters<typeof definition.createDefinitions>[0]) {
        const definitions = definition.createDefinitions(values)
        return {
          ...definitions,
          protocol: {
            ...definitions.protocol,
            canonicalizerDescriptor: { ...CANONICALIZER_DESCRIPTOR, unexpected: true },
          },
        }
      },
    } as SelectedDocumentOwnerArtifactDefinition<"canvas">
    expect(createSelectedDocumentOwnerArtifactFactory(selectedAuthority, "canvas").createRuntime(tampered)).toEqual({
      status: "rejected",
      code: "owner-runtime-invalid",
    })
  })

  test("rejects a stale descriptor digest before any durable write", async () => {
    const selectedAuthority = await authority()
    const definition = ownerDefinition()
    const stale = {
      ...definition,
      createDefinitions(values: Parameters<typeof definition.createDefinitions>[0]) {
        const definitions = definition.createDefinitions(values)
        return { ...definitions, protocol: { ...definitions.protocol, canonicalizerDigest: D1 } }
      },
    }
    expect(createSelectedDocumentOwnerArtifactFactory(selectedAuthority, "canvas").createRuntime(stale)).toEqual({
      status: "rejected",
      code: "owner-runtime-invalid",
    })
  })

  test("rejects wrong-format and defensively copies reused canonical-state bytes", async () => {
    const selectedAuthority = await authority()
    const definition = ownerDefinition()
    const wrongFormat = createSelectedDocumentOwnerArtifactFactory(selectedAuthority, "canvas").createRuntime({
      ...definition,
      createDefinitions(values) {
        const definitions = definition.createDefinitions(values)
        return {
          ...definitions,
          protocol: {
            ...definitions.protocol,
            canonicalStateBytes: () => encodeRestrictedJcs({ format: "convax.other-state" }),
          },
        }
      },
    })
    if ("status" in wrongFormat) throw new Error(wrongFormat.code)
    await expect(openKernel(new MemoryPersistence(), undefined, undefined, wrongFormat)).rejects.toThrow(
      "wrong top-level format",
    )
    const shared = encodeRestrictedJcs({ format: CANONICAL_STATE_FORMAT, value: {} })
    const reused = createSelectedDocumentOwnerArtifactFactory(selectedAuthority, "canvas").createRuntime({
      ...definition,
      createDefinitions(values) {
        const definitions = definition.createDefinitions(values)
        return { ...definitions, protocol: { ...definitions.protocol, canonicalStateBytes: () => shared } }
      },
    })
    if ("status" in reused) throw new Error(reused.code)
    const kernel = await openKernel(new MemoryPersistence(), undefined, undefined, reused)
    kernel.dispose()
  })

  test("rejects a local authority that omits the frozen four-owner artifact set", async () => {
    const persistence = new MemoryPersistence()
    const base = ports(persistence)
    const prepare = base.localAuthority.prepareFinalFrameAuthority.bind(base.localAuthority)
    const kernel = await openKernel(persistence, {
      localAuthority: {
        actorId: ACTOR,
        async prepareFinalFrameAuthority(input) {
          const result = await prepare(input)
          return typeof result === "string"
            ? result
            : { ...result, validationArtifacts: { format: "convax.validation-artifact-set", artifacts: [] } }
        },
      },
    })
    await expect(commit(kernel, "missing-artifacts")).rejects.toThrow("omits a frozen protocol owner artifact")
    expect(persistence.events).toEqual([])
    kernel.dispose()
  })
})

async function commit(kernel: CollaborationKernel, value: string, operationId = ID) {
  const typed = { format: "convax.typed-intent", kind: "set", value }
  const createFacts = factPortFactories.get(kernel)
  if (!createFacts) throw new Error("Kernel fact-port factory is absent")
  return kernel.commitLocalIntent({
    operationId,
    prepare: () => ({ typedIntent: typed, externalFacts: createFacts() }),
  })
}

describe("replicaDoc/candidateDoc durability", () => {
  test("uses exact durable-head verification without cloning the accepted head on a warm local commit", async () => {
    const persistence = new MemoryPersistence()
    persistence.fastHeadVerification = true
    const kernel = await openKernel(persistence)
    const loadsAfterOpen = persistence.headLoadCount
    await commit(kernel, "fast-head-verification")
    expect(persistence.headVerificationCount).toBe(2)
    expect(persistence.headLoadCount).toBe(loadsAfterOpen)
    kernel.dispose()
  })

  test("fails closed when the private accepted-head full-update cache is mutated", async () => {
    const persistence = new MemoryPersistence()
    const kernel = await openKernel(persistence)
    const privateHead = (kernel as unknown as { head: { fullUpdate: Uint8Array } }).head
    privateHead.fullUpdate[0] ^= 0xff
    await expect(commit(kernel, "mutated-head-cache", id(117))).rejects.toThrow("full-update cache was mutated")
    expect(persistence.events).toEqual([])
    kernel.dispose()
  })

  test("installs the private issued state after persistence mutates public evidence during await", async () => {
    const persistence = new MemoryPersistence()
    persistence.mutateMaterializationDuringJournal = true
    const kernel = await openKernel(persistence)
    const result = await commit(kernel, "private-after-await", id(119))
    expect(result.status).toBe("saved-locally")
    const projection = kernel.getProjectionSnapshot()
    expect(projection.stateVector).toEqual(persistence.head.stateVector)
    expect(projection.canonicalStateDigest).toBe(canonicalStateDigestFor({ value: "private-after-await" }))
    const rebuilt = new Y.Doc()
    Y.applyUpdate(rebuilt, projection.fullUpdate)
    expect(rebuilt.getMap("root").get("value")).toBe("private-after-await")
    rebuilt.destroy()
    kernel.dispose()
  })

  test("rejects an observer-widened accepted apply even when a delete preserves the state vector", async () => {
    const persistence = new MemoryPersistence()
    const selectedAuthority = await authority()
    const runtime = createSelectedDocumentOwnerArtifactFactory(selectedAuthority, "canvas").createRuntime({
      ...ownerDefinition(),
      installValidatedPostCache() {},
    })
    if ("status" in runtime) throw new Error(runtime.code)
    const kernel = await openKernel(persistence, undefined, undefined, runtime)
    const replica = (kernel as unknown as { replicaDoc: Y.Doc }).replicaDoc
    const observer = (transaction: Y.Transaction) => {
      if (transaction.origin === ACCEPTED_FRAME_ORIGIN) replica.getMap("root").delete("value")
    }
    replica.on("afterTransaction", observer)
    try {
      await expect(commit(kernel, "observer-delete", id(116))).rejects.toThrow(
        "authoritative in-memory application failed",
      )
      expect(persistence.events).toEqual(["object", "outbox", "journal", "head"])
      const projection = kernel.getProjectionSnapshot()
      const rebuilt = new Y.Doc()
      Y.applyUpdate(rebuilt, projection.fullUpdate)
      expect(projection.stateVector).toEqual(persistence.head.stateVector)
      expect(encodeStateVector(rebuilt)).toEqual(persistence.head.stateVector)
      expect(canonicalStateDigest(SCHEMA, canonicalStateBytes(rebuilt))).toBe(persistence.head.canonicalStateDigest)
      expect(projection.canonicalStateDigest).toBe(canonicalStateDigestFor({ value: "observer-delete" }))
    } finally {
      replica.off("afterTransaction", observer)
      kernel.dispose()
    }
  })

  test("accepts a durable exact delta when an existing delete set changes the apply event encoding", async () => {
    const persistence = new MemoryPersistence()
    const seeded = new Y.Doc()
    seeded.getMap("root").set("value", "deleted-base-value")
    seeded.getMap("root").delete("value")
    persistence.head = Object.freeze({
      ...persistence.head,
      fullUpdate: encodeFullUpdate(seeded),
      stateVector: encodeStateVector(seeded),
      canonicalStateDigest: canonicalStateDigest(SCHEMA, canonicalStateBytes(seeded)),
    })
    seeded.destroy()
    const selectedAuthority = await authority()
    const runtime = createSelectedDocumentOwnerArtifactFactory(selectedAuthority, "canvas").createRuntime({
      ...ownerDefinition(),
      installValidatedPostCache() {},
    })
    if ("status" in runtime) throw new Error(runtime.code)
    const kernel = await openKernel(persistence, undefined, undefined, runtime)
    const replica = (kernel as unknown as { replicaDoc: Y.Doc }).replicaDoc
    let applyEvent: Uint8Array | undefined
    const observer = (bytes: Uint8Array, origin: unknown) => {
      if (origin === ACCEPTED_FRAME_ORIGIN) applyEvent = Uint8Array.from(bytes)
    }
    replica.on("update", observer)
    try {
      const result = await commit(kernel, "after-delete-set", id(118))
      expect(result.status).toBe("saved-locally")
      expect(applyEvent).toBeDefined()
      expect(applyEvent).not.toEqual(result.frame.sections.yjsUpdate)
    } finally {
      replica.off("update", observer)
      kernel.dispose()
    }
  })

  test("arms owner candidate capture before the local transaction", async () => {
    const selectedAuthority = await authority()
    const definition = ownerDefinition()
    let arms = 0
    const runtime = createSelectedDocumentOwnerArtifactFactory(selectedAuthority, "canvas").createRuntime({
      ...definition,
      armCandidateTransactionCapture({ candidate }) {
        expect(candidate._transaction).toBeNull()
        arms += 1
      },
    })
    if ("status" in runtime) throw new Error(runtime.code)
    const persistence = new MemoryPersistence()
    const kernel = await openKernel(persistence, undefined, undefined, runtime)
    await commit(kernel, "armed", id(119))
    expect(arms).toBe(1)
    kernel.dispose()
  })

  test("treats an owner capture-hook failure as acceleration-only", async () => {
    const selectedAuthority = await authority()
    const definition = ownerDefinition()
    const runtime = createSelectedDocumentOwnerArtifactFactory(selectedAuthority, "canvas").createRuntime({
      ...definition,
      armCandidateTransactionCapture() {
        throw new Error("capture unavailable")
      },
    })
    if ("status" in runtime) throw new Error(runtime.code)
    const persistence = new MemoryPersistence()
    const kernel = await openKernel(persistence, undefined, undefined, runtime)
    expect((await commit(kernel, "capture-fallback", id(118))).status).toBe("saved-locally")
    expect(persistence.events).toEqual(["object", "outbox", "journal", "head"])
    kernel.dispose()
  })

  test("isolates a cache-hook throw after durability and fully validates the next base", async () => {
    const selectedAuthority = await authority()
    const definition = ownerDefinition()
    let baseValidations = 0
    const runtime = createSelectedDocumentOwnerArtifactFactory(selectedAuthority, "canvas").createRuntime({
      ...definition,
      installValidatedPostCache() {
        throw new Error("cache unavailable")
      },
      createDefinitions(values) {
        const definitions = definition.createDefinitions(values)
        const validateBase = definitions.protocol.validateBase.bind(definitions.protocol)
        return {
          ...definitions,
          protocol: {
            ...definitions.protocol,
            validateBase(document) {
              baseValidations += 1
              return validateBase(document)
            },
          },
        }
      },
    })
    if ("status" in runtime) throw new Error(runtime.code)
    const persistence = new MemoryPersistence()
    const kernel = await openKernel(persistence, undefined, undefined, runtime)

    expect((await commit(kernel, "one", id(120))).status).toBe("saved-locally")
    expect(persistence.events).toEqual(["object", "outbox", "journal", "head"])
    const beforeSecondCommit = baseValidations
    expect((await commit(kernel, "two", id(121))).status).toBe("saved-locally")
    expect(baseValidations).toBe(beforeSecondCommit + 1)
    expect(kernel.getProjectionSnapshot().canonicalStateDigest).toBe(canonicalStateDigestFor({ value: "two" }))
    kernel.dispose()
  })

  test("keeps the validated local candidate byte-identical to exact-base delta replay", async () => {
    const selectedAuthority = await authority()
    const definition = ownerDefinition()
    let candidateFullUpdate: Uint8Array | undefined
    let candidateStateVector: StateVector | undefined
    let candidateCanonicalDigest: Digest | undefined
    const runtime = createSelectedDocumentOwnerArtifactFactory(selectedAuthority, "canvas").createRuntime({
      ...definition,
      createDefinitions(values) {
        const definitions = definition.createDefinitions(values)
        const validatePost = definitions.protocol.validatePost.bind(definitions.protocol)
        return {
          ...definitions,
          protocol: {
            ...definitions.protocol,
            validatePost(base, candidate, result) {
              const validated = validatePost(base, candidate, result)
              candidateFullUpdate = encodeFullUpdate(candidate)
              candidateStateVector = encodeStateVector(candidate)
              candidateCanonicalDigest = canonicalStateDigest(SCHEMA, canonicalStateBytes(candidate))
              return validated
            },
          },
        }
      },
    })
    if ("status" in runtime) throw new Error(runtime.code)
    const persistence = new MemoryPersistence()
    const kernel = await openKernel(persistence, undefined, undefined, runtime)
    await commit(kernel, "candidate-replay")
    const evidence = persistence.materializationEvidence
    expect(evidence).toBeDefined()
    expect(evidence?.fullUpdate).toEqual(candidateFullUpdate)
    expect(evidence?.stateVector).toEqual(candidateStateVector)
    expect(evidence?.canonicalStateDigest).toBe(candidateCanonicalDigest)
    kernel.dispose()
  })

  test("uses one local candidate clone and records zero canonical-delta-validation calls", async () => {
    let documentCreations = 0
    const diagnostics: CollaborationLatencyDiagnostic[] = []
    const kernel = await openKernel(
      new MemoryPersistence(),
      {
        createDocument: () => {
          documentCreations += 1
          return new Y.Doc()
        },
      },
      undefined,
      undefined,
      {
        record: (value) => {
          diagnostics.push(value)
        },
      },
    )
    const afterOpen = documentCreations
    await commit(kernel, "one-candidate-clone", id(123))
    await Promise.resolve()
    expect(documentCreations - afterOpen).toBe(1)
    expect(diagnostics[0]!.stages["canonical-delta-validation"].callCount).toBe(0)
    kernel.dispose()
  })

  test("consumes one private digest-bound standby candidate without cloning in the next warm commit", async () => {
    let documentCreations = 0
    const kernel = await openKernel(new MemoryPersistence(), {
      createDocument: () => {
        documentCreations += 1
        return new Y.Doc()
      },
    })
    await commit(kernel, "standby-base", id(130))
    await new Promise((resolve) => setTimeout(resolve, 0))
    const afterStandbyBuild = documentCreations
    await commit(kernel, "standby-consumed", id(131))
    expect(documentCreations).toBe(afterStandbyBuild)
    kernel.dispose()
  })

  test("discards a standby candidate changed by a transaction and falls back to an exact clone", async () => {
    let documentCreations = 0
    const kernel = await openKernel(new MemoryPersistence(), {
      createDocument: () => {
        documentCreations += 1
        return new Y.Doc()
      },
    })
    await commit(kernel, "standby-mutation-base", id(132))
    await new Promise((resolve) => setTimeout(resolve, 0))
    const privateKernel = kernel as unknown as {
      standbyCandidate: { document: Y.Doc } | null
    }
    expect(privateKernel.standbyCandidate).not.toBeNull()
    privateKernel.standbyCandidate!.document.transact(() => undefined, "unexpected-standby-observer")
    const beforeFallback = documentCreations
    await commit(kernel, "standby-mutation-fallback", id(133))
    expect(documentCreations).toBe(beforeFallback + 1)
    kernel.dispose()
  })

  test("discards standby client-id and durable-head binding drift", async () => {
    let documentCreations = 0
    const kernel = await openKernel(new MemoryPersistence(), {
      createDocument: () => {
        documentCreations += 1
        return new Y.Doc()
      },
    })
    await commit(kernel, "standby-drift-base", id(134))
    await new Promise((resolve) => setTimeout(resolve, 0))
    const privateKernel = kernel as unknown as {
      standbyCandidate: { document: Y.Doc; durableHeadDigest: Digest } | null
    }
    privateKernel.standbyCandidate!.document.clientID += 1
    privateKernel.standbyCandidate!.durableHeadDigest = ordinarySha256(encoder.encode("wrong-standby-head"))
    const beforeFallback = documentCreations
    await commit(kernel, "standby-drift-fallback", id(135))
    expect(documentCreations).toBe(beforeFallback + 1)
    kernel.dispose()
  })

  test("cancels a queued standby build when the kernel is disposed", async () => {
    let documentCreations = 0
    const kernel = await openKernel(new MemoryPersistence(), {
      createDocument: () => {
        documentCreations += 1
        return new Y.Doc()
      },
    })
    await commit(kernel, "standby-dispose-race", id(136))
    const beforeDispose = documentCreations
    kernel.dispose()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(documentCreations).toBe(beforeDispose)
  })

  test("does not retain or rebuild a consumed standby after a durability crash", async () => {
    const persistence = new MemoryPersistence()
    const kernel = await openKernel(persistence)
    await commit(kernel, "standby-before-crash", id(137))
    await new Promise((resolve) => setTimeout(resolve, 0))
    const privateKernel = kernel as unknown as {
      standbyCandidate: object | null
      standbyCandidateTimer: ReturnType<typeof setTimeout> | null
    }
    expect(privateKernel.standbyCandidate).not.toBeNull()
    persistence.failAt = "journal"
    await expect(commit(kernel, "standby-crash", id(138))).rejects.toThrow("journal crash")
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(privateKernel.standbyCandidate).toBeNull()
    expect(privateKernel.standbyCandidateTimer).toBeNull()
    kernel.dispose()
  })

  test("discards standby frontier-digest binding drift and falls back to an exact clone", async () => {
    let documentCreations = 0
    const kernel = await openKernel(new MemoryPersistence(), {
      createDocument: () => {
        documentCreations += 1
        return new Y.Doc()
      },
    })
    await commit(kernel, "standby-frontier-base", id(139))
    await new Promise((resolve) => setTimeout(resolve, 0))
    const privateKernel = kernel as unknown as {
      standbyCandidate: { frontierDigest: Digest; document: Y.Doc } | null
    }
    expect(privateKernel.standbyCandidate).not.toBeNull()
    privateKernel.standbyCandidate!.frontierDigest = parseDigest("00".repeat(32))
    const beforeFallback = documentCreations
    await commit(kernel, "standby-frontier-fallback", id(140))
    expect(documentCreations).toBe(beforeFallback + 1)
    kernel.dispose()
  })

  test("discards standby full-update-digest binding drift and falls back to an exact clone", async () => {
    let documentCreations = 0
    const kernel = await openKernel(new MemoryPersistence(), {
      createDocument: () => {
        documentCreations += 1
        return new Y.Doc()
      },
    })
    await commit(kernel, "standby-fulldigest-base", id(141))
    await new Promise((resolve) => setTimeout(resolve, 0))
    const privateKernel = kernel as unknown as {
      standbyCandidate: { fullUpdateDigest: Digest } | null
    }
    expect(privateKernel.standbyCandidate).not.toBeNull()
    privateKernel.standbyCandidate!.fullUpdateDigest = parseDigest("01".repeat(32))
    const beforeFallback = documentCreations
    await commit(kernel, "standby-fulldigest-fallback", id(142))
    expect(documentCreations).toBe(beforeFallback + 1)
    kernel.dispose()
  })

  test("discards standby state-vector-digest binding drift and falls back to an exact clone", async () => {
    let documentCreations = 0
    const kernel = await openKernel(new MemoryPersistence(), {
      createDocument: () => {
        documentCreations += 1
        return new Y.Doc()
      },
    })
    await commit(kernel, "standby-svdigest-base", id(143))
    await new Promise((resolve) => setTimeout(resolve, 0))
    const privateKernel = kernel as unknown as {
      standbyCandidate: { stateVectorDigest: Digest } | null
    }
    expect(privateKernel.standbyCandidate).not.toBeNull()
    privateKernel.standbyCandidate!.stateVectorDigest = parseDigest("02".repeat(32))
    const beforeFallback = documentCreations
    await commit(kernel, "standby-svdigest-fallback", id(144))
    expect(documentCreations).toBe(beforeFallback + 1)
    kernel.dispose()
  })

  test("discards standby document-generation binding drift and falls back to an exact clone", async () => {
    let documentCreations = 0
    const kernel = await openKernel(new MemoryPersistence(), {
      createDocument: () => {
        documentCreations += 1
        return new Y.Doc()
      },
    })
    await commit(kernel, "standby-gen-base", id(145))
    await new Promise((resolve) => setTimeout(resolve, 0))
    const privateKernel = kernel as unknown as {
      standbyCandidate: { documentGeneration: number } | null
    }
    expect(privateKernel.standbyCandidate).not.toBeNull()
    privateKernel.standbyCandidate!.documentGeneration += 1
    const beforeFallback = documentCreations
    await commit(kernel, "standby-gen-fallback", id(146))
    expect(documentCreations).toBe(beforeFallback + 1)
    kernel.dispose()
  })

  test("discards standby scope-digest binding drift and falls back to an exact clone", async () => {
    let documentCreations = 0
    const kernel = await openKernel(new MemoryPersistence(), {
      createDocument: () => {
        documentCreations += 1
        return new Y.Doc()
      },
    })
    await commit(kernel, "standby-scope-base", id(147))
    await new Promise((resolve) => setTimeout(resolve, 0))
    const privateKernel = kernel as unknown as {
      standbyCandidate: { scopeDigest: Digest } | null
    }
    expect(privateKernel.standbyCandidate).not.toBeNull()
    privateKernel.standbyCandidate!.scopeDigest = parseDigest("03".repeat(32))
    const beforeFallback = documentCreations
    await commit(kernel, "standby-scope-fallback", id(148))
    expect(documentCreations).toBe(beforeFallback + 1)
    kernel.dispose()
  })

  test("falls back for a second wrong-origin transaction and multiple update events in validatePost", async () => {
    const selectedAuthority = await authority()
    const definition = ownerDefinition()
    const runtime = createSelectedDocumentOwnerArtifactFactory(selectedAuthority, "canvas").createRuntime({
      ...definition,
      createDefinitions(values) {
        const definitions = definition.createDefinitions(values)
        const validatePost = definitions.protocol.validatePost.bind(definitions.protocol)
        return {
          ...definitions,
          protocol: {
            ...definitions.protocol,
            validatePost(base, candidate, result) {
              candidate.transact(() => candidate.getMap("root").set("value", "validated-second-transaction"), {})
              return validatePost(base, candidate, result)
            },
          },
        }
      },
    })
    if ("status" in runtime) throw new Error(runtime.code)
    const diagnostics: CollaborationLatencyDiagnostic[] = []
    const kernel = await openKernel(new MemoryPersistence(), undefined, undefined, runtime, {
      record: (value) => {
        diagnostics.push(value)
      },
    })
    await commit(kernel, "initial-value", id(124))
    await Promise.resolve()
    expect(diagnostics[0]!.stages["canonical-delta-validation"].callCount).toBe(1)
    expect((kernel as unknown as { replicaDoc: Y.Doc }).replicaDoc.getMap("root").get("value")).toBe(
      "validated-second-transaction",
    )
    kernel.dispose()
  })

  test("rejects canonicalizer mutation after a validatePost mutation forced the full fallback", async () => {
    const selectedAuthority = await authority()
    const definition = ownerDefinition()
    const runtime = createSelectedDocumentOwnerArtifactFactory(selectedAuthority, "canvas").createRuntime({
      ...definition,
      createDefinitions(values) {
        const definitions = definition.createDefinitions(values)
        const validatePost = definitions.protocol.validatePost.bind(definitions.protocol)
        return {
          ...definitions,
          protocol: {
            ...definitions.protocol,
            validatePost(base, candidate, result) {
              candidate.transact(() => candidate.getMap("root").set("value", "fallback-post-state"), {})
              return validatePost(base, candidate, result)
            },
            canonicalStateBytes(document) {
              if (document.getMap("root").get("value") === "fallback-post-state") {
                document.getMap("root").set("value", "unvalidated-canonicalizer-state")
              }
              return definitions.protocol.canonicalStateBytes(document)
            },
          },
        }
      },
    })
    if ("status" in runtime) throw new Error(runtime.code)
    const persistence = new MemoryPersistence()
    const kernel = await openKernel(persistence, undefined, undefined, runtime)
    await expect(commit(kernel, "force-fallback", id(127))).rejects.toThrow("changed after owner post-validation")
    expect(persistence.events).toEqual([])
    kernel.dispose()
  })

  test("rejects canonicalizer mutation after post-validation before durability", async () => {
    const selectedAuthority = await authority()
    const definition = ownerDefinition()
    const runtime = createSelectedDocumentOwnerArtifactFactory(selectedAuthority, "canvas").createRuntime({
      ...definition,
      createDefinitions(values) {
        const definitions = definition.createDefinitions(values)
        return {
          ...definitions,
          protocol: {
            ...definitions.protocol,
            canonicalStateBytes(document) {
              if (document.getMap("root").get("value") === "canonicalizer-mutation") {
                document.getMap("root").set("value", "mutated-after-validation")
              }
              return definitions.protocol.canonicalStateBytes(document)
            },
          },
        }
      },
    })
    if ("status" in runtime) throw new Error(runtime.code)
    const persistence = new MemoryPersistence()
    const kernel = await openKernel(persistence, undefined, undefined, runtime)
    await expect(commit(kernel, "canonicalizer-mutation", id(125))).rejects.toThrow(
      "changed after owner post-validation",
    )
    expect(persistence.events).toEqual([])
    kernel.dispose()
  })

  test("falls back when validatePost drifts the candidate client id", async () => {
    const selectedAuthority = await authority()
    const definition = ownerDefinition()
    const runtime = createSelectedDocumentOwnerArtifactFactory(selectedAuthority, "canvas").createRuntime({
      ...definition,
      createDefinitions(values) {
        const definitions = definition.createDefinitions(values)
        const validatePost = definitions.protocol.validatePost.bind(definitions.protocol)
        return {
          ...definitions,
          protocol: {
            ...definitions.protocol,
            validatePost(base, candidate, result) {
              const validated = validatePost(base, candidate, result)
              candidate.clientID += 1
              return validated
            },
          },
        }
      },
    })
    if ("status" in runtime) throw new Error(runtime.code)
    const diagnostics: CollaborationLatencyDiagnostic[] = []
    const kernel = await openKernel(new MemoryPersistence(), undefined, undefined, runtime, {
      record: (value) => {
        diagnostics.push(value)
      },
    })
    await commit(kernel, "client-drift", id(126))
    await Promise.resolve()
    expect(diagnostics[0]!.stages["canonical-delta-validation"].callCount).toBe(1)
    kernel.dispose()
  })

  test("falls back and rejects a candidate delta that authors structs under another client", async () => {
    const selectedAuthority = await authority()
    const definition = ownerDefinition()
    const runtime = createSelectedDocumentOwnerArtifactFactory(selectedAuthority, "canvas").createRuntime({
      ...definition,
      createDefinitions(values) {
        const definitions = definition.createDefinitions(values)
        const validatePost = definitions.protocol.validatePost.bind(definitions.protocol)
        return {
          ...definitions,
          protocol: {
            ...definitions.protocol,
            validatePost(base, candidate, result) {
              const validated = validatePost(base, candidate, result)
              candidate.clientID += 1
              candidate.getMap("root").set("value", "other-client-struct")
              return validated
            },
          },
        }
      },
    })
    if ("status" in runtime) throw new Error(runtime.code)
    const persistence = new MemoryPersistence()
    const kernel = await openKernel(persistence, undefined, undefined, runtime)
    await expect(commit(kernel, "original-client-struct", id(128))).rejects.toThrow("other than the signer replica id")
    expect(persistence.events).toEqual([])
    kernel.dispose()
  })

  test("digests live post evidence without invoking the authoritative canonical-state port", async () => {
    const selectedAuthority = await authority()
    const definition = ownerDefinition()
    let canonicalCalls = 0
    const runtime = createSelectedDocumentOwnerArtifactFactory(selectedAuthority, "canvas").createRuntime({
      ...definition,
      readCertifiedCanonicalDigest: ({ expectedCanonicalStateDigest }) => expectedCanonicalStateDigest,
      createDefinitions(values) {
        const definitions = definition.createDefinitions(values)
        const validatePost = definitions.protocol.validatePost.bind(definitions.protocol)
        return {
          ...definitions,
          protocol: {
            ...definitions.protocol,
            validatePost(base, candidate, result) {
              const state = validatePost(base, candidate, result)
              if (typeof state === "string") return state
              return values.bindCanonicalJcsEvidence(
                candidate,
                state,
                values.canonicalJcs.encodeEvidence({
                  format: "convax.canvas-owner-runtime-test",
                  root: candidate.getMap("root").toJSON(),
                }),
              )
            },
            canonicalStateBytes(document) {
              canonicalCalls += 1
              return definitions.protocol.canonicalStateBytes(document)
            },
          },
        }
      },
    })
    if ("status" in runtime) throw new Error(runtime.code)
    const persistence = new MemoryPersistence()
    const kernel = await openKernel(persistence, undefined, undefined, runtime)
    const afterOpen = canonicalCalls
    expect((await commit(kernel, "evidence-fast-path", id(122))).status).toBe("saved-locally")
    expect(canonicalCalls).toBe(afterOpen)
    kernel.dispose()
  })

  test("crosses immutable object, outbox, journal and sole-head commit before replica projection", async () => {
    const persistence = new MemoryPersistence()
    const projected: string[] = []
    const kernel = await openKernel(persistence, undefined, projected)
    const result = await commit(kernel, "one")
    expect(result.status).toBe("saved-locally")
    expect(persistence.events).toEqual(["object", "outbox", "journal", "head"])
    expect(kernel.getProjectionSnapshot().canonicalStateDigest).toBe(canonicalStateDigestFor({ value: "one" }))
    expect(projected).toEqual([result.frame.frameDigest])
    kernel.dispose()
  })

  test("reports a closed identity-free latency breakdown without affecting commit success", async () => {
    const persistence = new MemoryPersistence()
    const diagnostics: CollaborationLatencyDiagnostic[] = []
    const kernel = await openKernel(persistence, undefined, undefined, undefined, {
      sample: () => ({ historyCount: 32, outboxCount: 4, cacheHit: true }),
      record: (diagnostic) => {
        diagnostics.push(diagnostic)
      },
    })
    await commit(kernel, "diagnosed")
    await Promise.resolve()
    await Promise.resolve()
    expect(diagnostics).toHaveLength(1)
    expect(diagnostics[0]).toMatchObject({
      format: "convax.collaboration-latency-diagnostic",
      version: 2,
      ownerKind: "canvas",
      outcome: "succeeded",
      sample: { historyCount: 32, outboxCount: 4, cacheHit: true },
    })
    expect(Object.keys(diagnostics[0]!.stages).sort()).toEqual(
      [
        "authority-prepare",
        "base-state-encode",
        "base-validation",
        "candidate-clone",
        "canonical-delta-validation",
        "canonical-state-digest",
        "delta-encode",
        "frame-decode",
        "frame-encode",
        "head",
        "head-check",
        "journal",
        "object",
        "operation-lookup",
        "outbox",
        "owner-prepare",
        "post-head-check",
        "projection",
        "queue",
        "reducer",
        "replica-apply",
        "sign",
      ].sort(),
    )
    expect(diagnostics[0]!.stages.object.durationMs).toBeGreaterThanOrEqual(0)
    expect(diagnostics[0]!.stages.object.callCount).toBe(1)
    expect(diagnostics[0]!.stages["canonical-delta-validation"].callCount).toBe(0)
    expect(diagnostics[0]!.stages["base-state-encode"].callCount).toBe(3)
    expect(diagnostics[0]!.apiObservedDurationMs).toBeGreaterThanOrEqual(diagnostics[0]!.totalDurationMs)
    expect(diagnostics[0]!.sampleDurationMs).toBeGreaterThanOrEqual(0)
    kernel.dispose()

    const isolated = await openKernel(new MemoryPersistence(), undefined, undefined, undefined, {
      record: () => {
        throw new Error("diagnostics unavailable")
      },
    })
    await expect(commit(isolated, "still-saved")).resolves.toMatchObject({ status: "saved-locally" })
    isolated.dispose()
  })

  test("starts commit-bound samples in queue order without awaiting slow sampling", async () => {
    const persistence = new MemoryPersistence()
    const observedHistory: number[] = []
    let releaseSample!: () => void
    const sampleGate = new Promise<void>((resolve) => {
      releaseSample = resolve
    })
    const kernel = await openKernel(persistence, undefined, undefined, undefined, {
      async sample() {
        const historyCount = persistence.accepted.size
        observedHistory.push(historyCount)
        await sampleGate
        return { historyCount }
      },
      record: () => undefined,
    })
    const first = commit(kernel, "first")
    await Promise.resolve()
    const second = commit(kernel, "second", parseId128(encodeBase64url(Uint8Array.from({ length: 16 }, () => 9))))
    await first
    await second
    expect(observedHistory).toEqual([1, 2])
    releaseSample()
    await Promise.resolve()
    await Promise.resolve()
    kernel.dispose()
  })

  test("diagnostic sample and record failures cannot change durable outcomes", async () => {
    const persistence = new MemoryPersistence()
    const sampleFailure = await openKernel(persistence, undefined, undefined, undefined, {
      sample: () => {
        throw new Error("sample failed")
      },
      record: () => {
        throw new Error("record failed")
      },
    })
    await expect(commit(sampleFailure, "durable")).resolves.toMatchObject({ status: "saved-locally" })
    expect(persistence.events).toEqual(["object", "outbox", "journal", "head"])
    sampleFailure.dispose()
  })

  test("skips sampling entirely when the synchronous diagnostics gate rejects the command", async () => {
    let samples = 0
    let records = 0
    const kernel = await openKernel(new MemoryPersistence(), undefined, undefined, undefined, {
      shouldSample: () => false,
      sample: () => {
        samples += 1
        return { historyCount: samples }
      },
      record: () => {
        records += 1
      },
    })
    await expect(commit(kernel, "fast")).resolves.toMatchObject({ status: "saved-locally" })
    await Promise.resolve()
    expect(samples).toBe(0)
    expect(records).toBe(0)
    kernel.dispose()
  })

  test("diagnostics preserve exact frame bytes and durable barrier events", async () => {
    const withoutDiagnosticsPersistence = new MemoryPersistence()
    const withoutDiagnostics = await openKernel(withoutDiagnosticsPersistence)
    const plain = await commit(withoutDiagnostics, "same")

    const withDiagnosticsPersistence = new MemoryPersistence()
    const withDiagnostics = await openKernel(withDiagnosticsPersistence, undefined, undefined, undefined, {
      sample: () => ({ historyCount: withDiagnosticsPersistence.accepted.size }),
      record: () => undefined,
    })
    const diagnosed = await commit(withDiagnostics, "same")

    expect(diagnosed.frame.bytes).toEqual(plain.frame.bytes)
    expect(withDiagnosticsPersistence.events).toEqual(withoutDiagnosticsPersistence.events)
    expect(withDiagnosticsPersistence.events).toEqual(["object", "outbox", "journal", "head"])
    withoutDiagnostics.dispose()
    withDiagnostics.dispose()
  })

  test("response-loss retry returns the original final frame without recomputation", async () => {
    const persistence = new MemoryPersistence()
    const kernel = await openKernel(persistence)
    const first = await commit(kernel, "one")
    const eventCount = persistence.events.length
    const retry = await commit(kernel, "different-command-body")
    expect(retry.status).toBe("duplicate")
    expect(retry.frame.bytes).toEqual(first.frame.bytes)
    expect(persistence.events).toHaveLength(eventCount)
    expect(kernel.getProjectionSnapshot().canonicalStateDigest).toBe(canonicalStateDigestFor({ value: "one" }))
    kernel.dispose()
  })

  test("post-head response loss reloads the accepted closure before returning the duplicate", async () => {
    const persistence = new MemoryPersistence()
    persistence.throwAfterHeadCommit = true
    const kernel = await openKernel(persistence)
    const createFacts = factPortFactories.get(kernel)!
    let prepareCount = 0
    const request = {
      operationId: ID,
      prepare: () => {
        prepareCount += 1
        return {
          typedIntent: { format: "convax.typed-intent", kind: "set", value: "committed-before-response" },
          externalFacts: createFacts(),
        }
      },
    }
    await expect(kernel.commitLocalIntent(request)).rejects.toThrow("post-head response loss")
    persistence.throwAfterHeadCommit = false
    const retry = await kernel.commitLocalIntent(request)
    expect(retry.status).toBe("duplicate")
    expect(prepareCount).toBe(1)
    expect(kernel.getProjectionSnapshot().canonicalStateDigest).toBe(
      canonicalStateDigestFor({ value: "committed-before-response" }),
    )
    const privateKernel = kernel as unknown as {
      standbyCandidate: object | null
      standbyCandidateTimer: ReturnType<typeof setTimeout> | null
    }
    expect(privateKernel.standbyCandidate).toBeNull()
    expect(privateKernel.standbyCandidateTimer).toBeNull()
    kernel.dispose()
  })

  test("serializes concurrent prepare callbacks against the latest base and next actor sequence", async () => {
    const persistence = new MemoryPersistence()
    const kernel = await openKernel(persistence)
    const createFacts = factPortFactories.get(kernel)!
    const observed: Array<{ base: unknown; actorSequence: string; lamport: string }> = []
    const request = (operationId: Id128, value: string) => ({
      operationId,
      prepare: ({ base, context }: Parameters<LocalIntentRequest["prepare"]>[0]) => {
        observed.push({
          base: structuredClone(base.value),
          actorSequence: context.actorSequence,
          lamport: context.lamport,
        })
        return {
          typedIntent: { format: "convax.typed-intent", kind: "set", value },
          externalFacts: createFacts(),
        }
      },
    })
    await Promise.all([
      kernel.commitLocalIntent(request(id(91), "one")),
      kernel.commitLocalIntent(request(id(92), "two")),
    ])
    expect(observed).toEqual([
      { base: {}, actorSequence: "1", lamport: "1" },
      { base: { value: "one" }, actorSequence: "2", lamport: "2" },
    ])
    expect(kernel.getProjectionSnapshot().canonicalStateDigest).toBe(canonicalStateDigestFor({ value: "two" }))
    kernel.dispose()
  })

  test("rejects reuse of one attempt fact port before the next object barrier", async () => {
    const persistence = new MemoryPersistence()
    const kernel = await openKernel(persistence)
    const facts = factPortFactories.get(kernel)!()
    const request = (operationId: Id128, value: string) => ({
      operationId,
      prepare: () => ({
        typedIntent: { format: "convax.typed-intent", kind: "set", value },
        externalFacts: facts,
      }),
    })
    await kernel.commitLocalIntent(request(id(93), "one"))
    const events = persistence.events.length
    await expect(kernel.commitLocalIntent(request(id(94), "two"))).rejects.toThrow(
      "reused across collaboration attempts",
    )
    expect(persistence.events).toHaveLength(events)
    kernel.dispose()
  })

  for (const stage of ["object", "outbox", "journal", "head"] as const) {
    test(`crash at ${stage} leaves replicaDoc unchanged`, async () => {
      const persistence = new MemoryPersistence()
      persistence.failAt = stage
      const projected: string[] = []
      const kernel = await openKernel(persistence, undefined, projected)
      const before = kernel.getProjectionSnapshot()
      await expect(commit(kernel, stage)).rejects.toThrow(`${stage} crash`)
      const after = kernel.getProjectionSnapshot()
      expect(after.canonicalStateDigest).toBe(before.canonicalStateDigest)
      expect(after.stateVector).toEqual(before.stateVector)
      expect(projected).toEqual([])
      persistence.failAt = null
      const retry = await commit(kernel, `retry-${stage}`)
      if (stage === "object") {
        expect(retry.status).toBe("saved-locally")
        expect(kernel.getProjectionSnapshot().canonicalStateDigest).toBe(
          canonicalStateDigestFor({ value: `retry-${stage}` }),
        )
      } else {
        expect(retry.status).toBe("recovered-final-frame")
        expect(kernel.getProjectionSnapshot().canonicalStateDigest).toBe(canonicalStateDigestFor({ value: stage }))
      }
      kernel.dispose()
    })
  }

  test("a stale sole durable head discards the candidate", async () => {
    const persistence = new MemoryPersistence()
    persistence.stale = true
    const kernel = await openKernel(persistence)
    const before = kernel.getProjectionSnapshot()
    await expect(commit(kernel, "stale")).rejects.toMatchObject({ code: "equivocation-quarantine" })
    expect(kernel.getProjectionSnapshot().stateVector).toEqual(before.stateVector)
    kernel.dispose()
  })

  test("crash at each durability barrier preserves exact durable-frame and journal bytes", async () => {
    for (const stage of ["outbox", "journal", "head"] as const) {
      const persistence = new MemoryPersistence()
      persistence.failAt = stage
      const kernel = await openKernel(persistence)
      const idValue = parseId128(encodeBase64url(Uint8Array.from({ length: 16 }, (_, i) => i * 7 + 1)))
      await expect(commit(kernel, `crash-${stage}`, idValue)).rejects.toThrow(`${stage} crash`)
      persistence.failAt = null
      const retry = await commit(kernel, `recover-${stage}`, idValue)
      expect(retry.status).toBe("recovered-final-frame")
      const storedRef = persistence.refsByDigest.get(retry.frame.frameDigest)
      expect(storedRef).toBeDefined()
      const storedBytes = persistence.objects.get(retry.frame.frameDigest)
      expect(storedBytes).toBeDefined()
      expect(storedBytes).toEqual(retry.frame.bytes)
      kernel.dispose()
    }
  })
})

describe("incoming exact-base arrival order", () => {
  test("retains a missing predecessor, then accepts the same signed bytes in causal order", async () => {
    const sourceStore = new MemoryPersistence()
    const source = await openKernel(sourceStore)
    const first = await commit(source, "one", parseId128(encodeBase64url(Uint8Array.from({ length: 16 }, () => 1))))
    const second = await commit(source, "two", parseId128(encodeBase64url(Uint8Array.from({ length: 16 }, () => 2))))
    const firstFrame = first.frame
    const secondFrame = second.frame
    const exactBases = new Map<string, ReturnType<typeof exactBase>>()
    exactBases.set(firstFrame.frameDigest, exactBase(firstFrame, []))
    exactBases.set(secondFrame.frameDigest, exactBase(secondFrame, [firstFrame]))
    const receiverStore = new MemoryPersistence()
    const pending: string[] = []
    const projected: string[] = []
    let receiverDocumentCreations = 0
    const receiver = await openKernel(
      receiverStore,
      {
        createDocument: () => {
          receiverDocumentCreations += 1
          return new Y.Doc()
        },
        exactBaseResolver: { reconstructExactBase: async (frame) => exactBases.get(frame.frameDigest)! },
        pendingInbox: {
          retainExactFrame: async (frame) => {
            pending.push(frame.frameDigest)
            return "retained"
          },
        },
        causalClosure: {
          contains: (descendant, ancestor) =>
            descendant === secondFrame.frameDigest && ancestor === firstFrame.frameDigest,
        },
      },
      projected,
    )
    const afterReceiverOpen = receiverDocumentCreations
    expect((await receiver.receiveFrame(secondFrame.bytes)).status).toBe("dependency-pending")
    expect(pending).toEqual([secondFrame.frameDigest])
    expect((await receiver.receiveFrame(firstFrame.bytes)).status).toBe("accepted")
    expect(receiverDocumentCreations - afterReceiverOpen).toBe(4)
    expect(receiverStore.events).toEqual(["object", "outbox", "journal", "head"])
    expect(projected).toEqual([firstFrame.frameDigest])
    expect((await receiver.receiveFrame(secondFrame.bytes)).status).toBe("accepted")
    expect(receiverStore.events).toEqual(["object", "outbox", "journal", "head", "object", "outbox", "journal", "head"])
    expect(projected).toEqual([firstFrame.frameDigest, secondFrame.frameDigest])
    expect(receiver.getProjectionSnapshot().canonicalStateDigest).toBe(canonicalStateDigestFor({ value: "two" }))
    const privateReceiver = receiver as unknown as {
      standbyCandidate: object | null
      standbyCandidateTimer: ReturnType<typeof setTimeout> | null
    }
    expect(privateReceiver.standbyCandidate).toBeNull()
    expect(privateReceiver.standbyCandidateTimer).toBeNull()
    source.dispose()
    receiver.dispose()
  })

  test("fails closed for rejected, stale and cancelled incoming fact attempts", async () => {
    const source = await openKernel(new MemoryPersistence())
    const authored = await commit(source, "incoming-facts", id(101))
    const base = exactBase(authored.frame, [])
    for (const status of ["pending", "stale"] as const) {
      const receiver = await openKernel(new MemoryPersistence(), {
        exactBaseResolver: { reconstructExactBase: async () => base },
        incomingFacts: { resolve: async () => ({ status }) },
      })
      expect((await receiver.receiveFrame(authored.frame.bytes)).status).toBe("dependency-pending")
      receiver.dispose()
    }
    const rejected = await openKernel(new MemoryPersistence(), {
      exactBaseResolver: { reconstructExactBase: async () => base },
      incomingFacts: { resolve: async () => ({ status: "rejected" }) },
    })
    await expect(rejected.receiveFrame(authored.frame.bytes)).rejects.toThrow("fact resolution is rejected")
    rejected.dispose()

    const controller = new AbortController()
    let createFacts: (() => OwnerExternalFactPort<"canvas">) | undefined
    const cancelled = await openKernel(new MemoryPersistence(), {
      exactBaseResolver: { reconstructExactBase: async () => base },
      incomingFacts: {
        resolve: async () => {
          controller.abort()
          if (!createFacts) throw new Error("Fact factory is not installed")
          return { status: "resolved", port: createFacts() }
        },
      },
    })
    createFacts = factPortFactories.get(cancelled)
    await expect(cancelled.receiveFrame(authored.frame.bytes, controller.signal)).rejects.toMatchObject({
      code: "cancelled",
    })
    expect(cancelled.getProjectionSnapshot().canonicalStateDigest).toBe(canonicalStateDigestFor({}))
    cancelled.dispose()
    source.dispose()
  })
})

describe("incoming and recovery frame complete validation regression", () => {
  test("rejects a received frame when the exact base canonical digest mismatches, proving the full validator runs", async () => {
    const sourcePersistence = new MemoryPersistence()
    const source = await openKernel(sourcePersistence)
    const authored = await commit(source, "complete-validator-source", id(150))
    const sourceFrame = authored.frame

    const base = exactBase(authored.frame, [])
    const mismatchedBase = {
      ...base,
      canonicalStateDigest: parseDigest("ff".repeat(32)),
    }

    const receiverStore = new MemoryPersistence()
    const receiver = await openKernel(receiverStore, {
      exactBaseResolver: { reconstructExactBase: async () => mismatchedBase },
    })

    await expect(receiver.receiveFrame(sourceFrame.bytes)).rejects.toThrow(
      "Incoming frame exact base bytes mismatch its signed core",
    )
    expect(receiverStore.events).toEqual([])
    expect(
      receiver.getProjectionSnapshot().canonicalStateDigest,
    ).toBe(canonicalStateDigestFor({}))
    source.dispose()
    receiver.dispose()
  })

  test("receiving a valid frame from another kernel exercises the complete object-outbox-journal-head chain", async () => {
    const sourcePersistence = new MemoryPersistence()
    const source = await openKernel(sourcePersistence)
    const authored = await commit(source, "cross-kernel-validator", id(151))
    const sourceFrame = authored.frame

    const exactBases = new Map<string, ReturnType<typeof exactBase>>()
    exactBases.set(sourceFrame.frameDigest, exactBase(authored.frame, []))

    const receiverStore = new MemoryPersistence()
    const projected: string[] = []
    const receiver = await openKernel(receiverStore, {
      exactBaseResolver: { reconstructExactBase: async () => exactBases.get(sourceFrame.frameDigest)! },
    }, projected)

    const result = await receiver.receiveFrame(sourceFrame.bytes)
    expect(result.status).toBe("accepted")
    expect(receiverStore.events).toEqual(["object", "outbox", "journal", "head"])
    expect(projected).toEqual([sourceFrame.frameDigest])
    expect(receiver.getProjectionSnapshot().canonicalStateDigest).toBe(
      canonicalStateDigestFor({ value: "cross-kernel-validator" }),
    )
    source.dispose()
    receiver.dispose()
  })
})

function exactBase(frame: DecodedCausalEditFrame, prior: readonly DecodedCausalEditFrame[]) {
  const document = new Y.Doc()
  for (const item of prior) Y.applyUpdate(document, item.sections.yjsUpdate)
  const heads = prior.length === 0 ? [] : [headRef(prior.at(-1)!)]
  const value = {
    fullUpdate: encodeFullUpdate(document),
    stateVector: frame.sections.baseStateVector,
    frontier: frame.context.baseFrontier,
    actorHeads: { format: "convax.replica-actor-head-set" as const, scope: SCOPE, heads },
    canonicalStateDigest: frame.header.core.baseCanonicalStateDigest,
  }
  document.destroy()
  return value
}

function headRef(frame: DecodedCausalEditFrame) {
  const core = frame.header.core
  return {
    format: "convax.causal-head-ref" as const,
    actorId: core.actorId,
    actorSequence: core.actorSequence,
    frameDigest: frame.frameDigest,
    lamport: core.lamport,
  }
}

function canonicalStateBytes(document: Y.Doc): Uint8Array {
  return encodeRestrictedJcs({ format: CANONICAL_STATE_FORMAT, value: document.getMap("root").toJSON() })
}

function canonicalStateDigestFor(value: unknown) {
  return canonicalStateDigest(SCHEMA, encodeRestrictedJcs({ format: CANONICAL_STATE_FORMAT, value }))
}

function requiredValidationArtifacts() {
  return {
    format: "convax.validation-artifact-set" as const,
    artifacts: [
      {
        owner: "canvas" as const,
        format: PROTOCOL_SCHEMA_ARTIFACTS[0].format,
        artifactDigest: parseDigest(PROTOCOL_SCHEMA_ARTIFACTS[0].artifactDigest),
      },
      {
        owner: "control-plane" as const,
        format: PROTOCOL_SCHEMA_ARTIFACTS[2].format,
        artifactDigest: parseDigest(PROTOCOL_SCHEMA_ARTIFACTS[2].artifactDigest),
      },
      {
        owner: "kernel" as const,
        format: PROTOCOL_SCHEMA_ARTIFACTS[1].format,
        artifactDigest: parseDigest(PROTOCOL_SCHEMA_ARTIFACTS[1].artifactDigest),
      },
      {
        owner: "project-index" as const,
        format: PROTOCOL_SCHEMA_ARTIFACTS[3].format,
        artifactDigest: parseDigest(PROTOCOL_SCHEMA_ARTIFACTS[3].artifactDigest),
      },
    ],
  }
}

function id(seed: number): Id128 {
  return parseId128(encodeBase64url(new Uint8Array(16).fill(seed)))
}
