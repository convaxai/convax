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
import { ordinarySha256 } from "./digest"
import { materializeAcceptedFrame, validateAcceptedHeadMaterializationEvidence } from "./accepted-head"
import { createOwnerStateCommitmentIssuer } from "./owner-state-commitment"
import { decodeCausalEditFrame } from "./frame"
import { decodeRestrictedJcs, encodeRestrictedJcs } from "./jcs"
import { CollaborationKernel, type LocalIntentRequest } from "./kernel"
import type { CollaborationLatencyDiagnostic, CollaborationLatencyDiagnosticsPort } from "./latency-diagnostics"
import { createSelectedDocumentOwnerArtifactFactory } from "./owner-runtime"
import type {
  AcceptedHeadMaterializationEvidence,
  AcceptedHeadDurableDeltaMetadata,
  AcceptedHeadView,
  CollaborationKernelPorts,
  CollaborationPersistencePort,
  LocalFrameAuthority,
  OperationLookup,
} from "./ports"
import {
  ACCEPTED_FRAME_ORIGIN,
  encodeFullUpdate,
  encodeStateVector,
  testOnlyYjsCodecWorkCounts,
} from "./yjs-codec"
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
  stateCommitment: Object.freeze({
    format: "convax.owner-state-commitment-descriptor" as const,
    commitmentCodec: "sha256-merkle-patricia-v1" as const,
    canonicalKeyPathPolicy: "nfc-utf8-no-nul-bounded-v1" as const,
    maxCanonicalNameUtf8Bytes: "128" as const,
    maxCanonicalKeyUtf8Bytes: "1024" as const,
    scalarNames: Object.freeze(["format"]),
    collectionNames: Object.freeze(["root"]),
  }),
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
      const validateState = (document: Y.Doc) => {
        const value = document.getMap("root").toJSON()
        const state = processValues.wrapValidatedState(value)
        const commitment = processValues.stateCommitment.build({
          descriptor: CANONICALIZER_DESCRIPTOR.stateCommitment,
          scalars: [{ name: "format", value: CANONICAL_STATE_FORMAT }],
          collections: [{
            name: "root",
            entries: Object.entries(value).map(([key, entryValue]) => ({ key, value: entryValue })),
          }],
        })
        return processValues.bindStateCommitment(document, state, commitment)
      }
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
            ? validateState(document)
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
            ? validateState(candidate)
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
  failAt: "atomic" | null = null
  stale = false
  loseResponseAfterAtomicCommit = false
  fastHeadVerification = false
  headLoadCount = 0
  headVerificationCount = 0
  atomicCommitCallCount = 0
  responseLossRecoveredCount = 0
  lastCommitRequest: Parameters<CollaborationPersistencePort["commitAcceptedFrame"]>[0] | undefined
  materializationEvidence: AcceptedHeadMaterializationEvidence | undefined
  durableDelta: AcceptedHeadDurableDeltaMetadata | undefined
  nextLoadedHead: AcceptedHeadView | undefined
  hotFullUpdateEncodes = 0
  private readonly atomicResults = new Map<string, Awaited<ReturnType<CollaborationPersistencePort["commitAcceptedFrame"]>>>()
  private readonly atomicExpectedHeads = new Map<string, Digest>()
  private readonly materializedDocument = new Y.Doc()
  head: AcceptedHeadView

  constructor() {
    this.head = emptyHead()
    Y.applyUpdate(this.materializedDocument, this.head.fullUpdate)
  }

  async loadReplicaHead(): Promise<AcceptedHeadView> {
    this.headLoadCount += 1
    if (this.nextLoadedHead) {
      const loaded = this.nextLoadedHead
      this.nextLoadedHead = undefined
      return loaded
    }
    this.head = {
      ...this.head,
      fullUpdate: encodeFullUpdate(this.materializedDocument),
      stateVector: encodeStateVector(this.materializedDocument),
    }
    return this.head
  }
  seed(document: Y.Doc, canonicalStateDigest: Digest): void {
    Y.applyUpdate(this.materializedDocument, encodeFullUpdate(document))
    this.head = {
      ...this.head,
      fullUpdate: encodeFullUpdate(document),
      stateVector: encodeStateVector(document),
      canonicalStateDigest,
      materializationDigest: ordinarySha256(encoder.encode(`seed:${canonicalStateDigest}`)),
    }
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
  async commitAcceptedFrame(input: Parameters<CollaborationPersistencePort["commitAcceptedFrame"]>[0]) {
    this.events.push("atomic")
    this.atomicCommitCallCount += 1
    this.lastCommitRequest = input
    const existing = this.atomicResults.get(input.ref.frameDigest)
    if (existing) {
      if (this.atomicExpectedHeads.get(input.ref.frameDigest) !== input.expectedHead.headDigest) {
        return { status: "rejected" as const, code: "store-corrupt" as const }
      }
      return existing
    }
    if (this.failAt === "atomic") throw new Error("atomic crash")
    const validated = validateAcceptedHeadMaterializationEvidence({
      previous: input.expectedHead,
      ref: input.ref,
      evidence: input.accepted,
    })
    if (validated === "rejected") return { status: "rejected" as const, code: "store-corrupt" as const }
    this.materializationEvidence = input.accepted
    this.durableDelta = validated.durableDelta
    if (this.stale) {
      const quarantined = {
        status: "quarantined" as const,
        evidence: {
          format: "convax.accepted-frame-atomic-quarantine-evidence" as const,
          ref: input.ref,
          expectedReplicaHeadRecordDigest: input.expectedHead.headDigest,
          observedReplicaHeadRecordDigest: ordinarySha256(encoder.encode("other-head")),
          quarantinedFrameRecordDigest: ordinarySha256(encoder.encode(`quarantined-frame:${input.ref.frameDigest}`)),
          quarantineCommitRecordDigest: ordinarySha256(encoder.encode("quarantine")),
          shardDispositionHeadRecordDigest: this.head.headDigest,
          atomicCommitRecordDigest: ordinarySha256(encoder.encode(`atomic-quarantine:${input.ref.frameDigest}`)),
        },
      }
      this.atomicResults.set(input.ref.frameDigest, quarantined)
      this.atomicExpectedHeads.set(input.ref.frameDigest, input.expectedHead.headDigest)
      return quarantined
    }
    const ref = input.ref
    this.objects.set(ref.frameDigest, Uint8Array.from(input.exactFrameBytes))
    this.refsByDigest.set(ref.frameDigest, ref)
    const headDigest = ordinarySha256(encoder.encode(`head:${ref.frameDigest}`))
    this.accepted.set(`${ref.actorId}:${ref.operationId}`, ref)
    const frame = decodeCausalEditFrame(await authority(), this.objects.get(ref.frameDigest)!)
    Y.applyUpdate(this.materializedDocument, frame.sections.yjsUpdate)
    const transition = validated.transition
    this.head = {
      ...this.head,
      headDigest,
      frontier: transition.frontier,
      frontierDigest: transition.frontierDigest,
      actorHeads: transition.actorHeads,
      stateVector: transition.stateVector,
      canonicalStateDigest: transition.canonicalStateDigest,
      materializationDigest: transition.materializationDigest,
    }
    const committed = {
      status: "committed" as const,
      evidence: {
        format: "convax.accepted-frame-atomic-commit-evidence" as const,
        ref,
        frameRecordDigest: ordinarySha256(encoder.encode(`frame-record:${ref.frameDigest}`)),
        outboxRecordDigest: ordinarySha256(encoder.encode(`outbox:${ref.frameDigest}`)),
        journalRecordDigest: ordinarySha256(encoder.encode(`journal:${ref.frameDigest}`)),
        expectedReplicaHeadRecordDigest: input.expectedHead.headDigest,
        resultingReplicaHeadRecordDigest: headDigest,
        resultingFrontierDigest: transition.frontierDigest,
        resultingMaterializationDigest: transition.materializationDigest,
        atomicCommitRecordDigest: ordinarySha256(encoder.encode(`atomic:${ref.frameDigest}`)),
      },
    }
    this.atomicResults.set(ref.frameDigest, committed)
    this.atomicExpectedHeads.set(ref.frameDigest, input.expectedHead.headDigest)
    if (this.loseResponseAfterAtomicCommit) {
      this.loseResponseAfterAtomicCommit = false
      this.responseLossRecoveredCount += 1
      throw new Error("committed response lost")
    }
    return this.atomicResults.get(ref.frameDigest)!
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
    canonicalStateDigest: canonicalStateDigestFor(doc.getMap("root").toJSON()),
    materializationDigest: ordinarySha256(encoder.encode("genesis-materialization")),
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

  test("does not invoke the retired flat canonical-state encoder on open", async () => {
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
    const wrongFormatKernel = await openKernel(new MemoryPersistence(), undefined, undefined, wrongFormat)
    wrongFormatKernel.dispose()
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
    expect(persistence.headVerificationCount).toBe(1)
    expect(persistence.headLoadCount).toBe(loadsAfterOpen)
    kernel.dispose()
  })

  test("does not consult the cold accepted-head full-update cache on a warm commit", async () => {
    const persistence = new MemoryPersistence()
    const kernel = await openKernel(persistence)
    const privateHead = (kernel as unknown as { head: { fullUpdate: Uint8Array } }).head
    privateHead.fullUpdate[0] ^= 0xff
    const result = await commit(kernel, "mutated-head-cache", id(117))
    expect(result.status).toBe("saved-locally")
    kernel.dispose()
  })

  test("cold reload clones the full update and consumes the exact owner commitment before caching it", async () => {
    const persistence = new MemoryPersistence()
    const kernel = await openKernel(persistence)
    await commit(kernel, "cat", id(115))
    const durable = await persistence.loadReplicaHead()
    const tamperedFullUpdate = replaceAsciiOnce(durable.fullUpdate, "cat", "dog")
    persistence.nextLoadedHead = { ...durable, fullUpdate: tamperedFullUpdate }
    const cold = kernel as unknown as {
      headMaterialized: boolean
      reloadCurrentHeadMaterialization(): Promise<void>
    }
    expect(cold.headMaterialized).toBe(false)
    await expect(cold.reloadCurrentHeadMaterialization()).rejects.toThrow(
      "canonical-state digest mismatches accepted durable evidence",
    )
    expect(cold.headMaterialized).toBe(false)
    kernel.dispose()
  })

  test("cold reload rejects a full update whose declared state vector is not its exact base", async () => {
    const persistence = new MemoryPersistence()
    const kernel = await openKernel(persistence)
    await commit(kernel, "state-vector-bound", id(116))
    const durable = await persistence.loadReplicaHead()
    persistence.nextLoadedHead = { ...durable, stateVector: emptyHead().stateVector }
    const cold = kernel as unknown as {
      headMaterialized: boolean
      reloadCurrentHeadMaterialization(): Promise<void>
    }
    await expect(cold.reloadCurrentHeadMaterialization()).rejects.toMatchObject({ code: "stale-local-head" })
    expect(cold.headMaterialized).toBe(false)
    kernel.dispose()
  })

  test("cold recovery replays the exact signed frame and rejects tampered durable delta metadata", async () => {
    const selectedAuthority = await authority()
    const runtime = createSelectedDocumentOwnerArtifactFactory(selectedAuthority, "canvas").createRuntime(
      ownerDefinition(),
    )
    if ("status" in runtime) throw new Error(runtime.code)
    const persistence = new MemoryPersistence()
    const previous = persistence.head
    const kernel = await openKernel(persistence, undefined, undefined, runtime)
    const saved = await commit(kernel, "cold-replay", id(114))
    const ref = persistence.lastCommitRequest!.ref
    const recovered = materializeAcceptedFrame({
      authority: selectedAuthority,
      owner: runtime,
      previous,
      ref,
      exactFrameBytes: saved.frame.bytes,
      durableDelta: persistence.durableDelta,
      causalClosure: { contains: () => false },
      createDocument: () => new Y.Doc(),
    })
    expect(recovered.canonicalStateDigest).toBe(canonicalStateDigestFor({ value: "cold-replay" }))
    expect(recovered.materializationDigest).toBe(persistence.durableDelta!.resultingMaterializationDigest)
    expect(() => materializeAcceptedFrame({
      authority: selectedAuthority,
      owner: runtime,
      previous,
      ref,
      exactFrameBytes: saved.frame.bytes,
      durableDelta: { ...persistence.durableDelta!, canonicalStateDigest: ordinarySha256(encoder.encode("tampered")) },
      causalClosure: { contains: () => false },
      createDocument: () => new Y.Doc(),
    })).toThrow("durable delta metadata commitment mismatches")
    kernel.dispose()
  })

  test("installs the private issued state even if an adapter later mutates its durable projection clone", async () => {
    const persistence = new MemoryPersistence()
    const kernel = await openKernel(persistence)
    const result = await commit(kernel, "private-after-await", id(119))
    expect(result.status).toBe("saved-locally")
    persistence.durableDelta!.stateVector.fill(0xff)
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
      expect(persistence.events).toEqual(["atomic"])
      const projection = kernel.getProjectionSnapshot()
      const rebuilt = new Y.Doc()
      Y.applyUpdate(rebuilt, projection.fullUpdate)
      expect(projection.stateVector).toEqual(persistence.head.stateVector)
      expect(encodeStateVector(rebuilt)).toEqual(persistence.head.stateVector)
      expect(canonicalStateDigestFor(rebuilt.getMap("root").toJSON())).toBe(persistence.head.canonicalStateDigest)
      expect(projection.canonicalStateDigest).toBe(canonicalStateDigestFor({ value: "observer-delete" }))
    } finally {
      replica.off("afterTransaction", observer)
      kernel.dispose()
    }
  })

  test("persists the exact single-transaction update without rescanning a pre-existing delete set", async () => {
    const persistence = new MemoryPersistence()
    const seeded = new Y.Doc()
    seeded.getMap("root").set("value", "deleted-base-value")
    seeded.getMap("root").delete("value")
    const seededCanonicalDigest = canonicalStateDigestFor(seeded.getMap("root").toJSON())
    const seededFullUpdate = encodeFullUpdate(seeded)
    persistence.seed(seeded, seededCanonicalDigest)
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
      const before = testOnlyYjsCodecWorkCounts()
      const result = await commit(kernel, "after-delete-set", id(118))
      expect(result.status).toBe("saved-locally")
      expect(applyEvent).toBeDefined()
      expect(applyEvent).toEqual(result.frame.sections.yjsUpdate)
      expect(testOnlyYjsCodecWorkCounts().candidateDeltaFullDocumentEncodes - before.candidateDeltaFullDocumentEncodes).toBe(0)

      const receiverPersistence = new MemoryPersistence()
      receiverPersistence.seed(seeded, seededCanonicalDigest)
      const receiver = await openKernel(receiverPersistence, {
        exactBaseResolver: {
          reconstructExactBase: async () => ({
            fullUpdate: seededFullUpdate,
            stateVector: result.frame.sections.baseStateVector,
            frontier: result.frame.context.baseFrontier,
            actorHeads: {
              format: "convax.replica-actor-head-set",
              scope: SCOPE,
              heads: [],
            },
            canonicalStateDigest: result.frame.header.core.baseCanonicalStateDigest,
          }),
        },
      })
      expect((await receiver.receiveFrame(result.frame.bytes)).status).toBe("accepted")
      receiver.dispose()
    } finally {
      seeded.destroy()
      replica.off("update", observer)
      kernel.dispose()
    }
  })

  test("keeps fixed-size local commits independent of retained Yjs struct history", async () => {
    const checkpoints = [256, 1_024, 4_096] as const
    const deltaByteLengths = new Map<number, number>()
    const retainedUpdateByteLengths = new Map<number, number>()
    const before = testOnlyYjsCodecWorkCounts()
    for (const checkpoint of checkpoints) {
      const persistence = new MemoryPersistence()
      persistence.fastHeadVerification = true
      const seeded = new Y.Doc()
      const retained = new Y.Map<string>()
      seeded.getMap("root").set("value", retained)
      for (let index = 1; index <= checkpoint; index += 1) {
        seeded.transact(() => {
          retained.set(`entry-${index.toString(36).padStart(3, "0")}`, `v${index.toString(36).padStart(3, "0")}`)
        })
      }
      retainedUpdateByteLengths.set(checkpoint, encodeFullUpdate(seeded).byteLength)
      persistence.seed(seeded, canonicalStateDigestFor(seeded.getMap("root").toJSON()))
      const kernel = await openKernel(persistence)
      try {
        const result = await commit(kernel, `after-${checkpoint}`, operationId(checkpoint))
        expect(result.status).toBe("saved-locally")
        deltaByteLengths.set(checkpoint, result.frame.sections.yjsUpdate.byteLength)
      } finally {
        kernel.dispose()
        seeded.destroy()
      }
    }
    expect(retainedUpdateByteLengths.get(1_024)).toBeGreaterThan(retainedUpdateByteLengths.get(256)!)
    expect(retainedUpdateByteLengths.get(4_096)).toBeGreaterThan(retainedUpdateByteLengths.get(1_024)!)
    expect(testOnlyYjsCodecWorkCounts().candidateDeltaFullDocumentEncodes - before.candidateDeltaFullDocumentEncodes).toBe(0)
    expect(deltaByteLengths.get(1_024)).toBeLessThanOrEqual(deltaByteLengths.get(256)! + 8)
    expect(deltaByteLengths.get(4_096)).toBeLessThanOrEqual(deltaByteLengths.get(256)! + 8)
  }, 30_000)

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
    expect(persistence.events).toEqual(["atomic"])
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
    expect(persistence.events).toEqual(["atomic"])
    const beforeSecondCommit = baseValidations
    expect((await commit(kernel, "two", id(121))).status).toBe("saved-locally")
    expect(baseValidations).toBe(beforeSecondCommit + 1)
    expect(kernel.getProjectionSnapshot().canonicalStateDigest).toBe(canonicalStateDigestFor({ value: "two" }))
    kernel.dispose()
  })

  test("keeps the validated local candidate byte-identical to exact-base delta replay", async () => {
    const selectedAuthority = await authority()
    const definition = ownerDefinition()
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
              candidateStateVector = encodeStateVector(candidate)
              candidateCanonicalDigest = canonicalStateDigestFor(candidate.getMap("root").toJSON())
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
    expect(persistence.durableDelta?.stateVector).toEqual(candidateStateVector)
    expect(evidence?.canonicalStateDigest).toBe(candidateCanonicalDigest)
    expect(evidence?.work.fullUpdateEncodes).toBe(0)
    kernel.dispose()
  })

  test("builds the private candidate during cold open and performs no first-mutation clone", async () => {
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
    expect(documentCreations - afterOpen).toBe(0)
    expect((kernel as unknown as { standbyCandidate: object | null }).standbyCandidate).not.toBeNull()
    expect(diagnostics[0]!.stages["canonical-delta-validation"].callCount).toBe(0)
    kernel.dispose()
  })

  test("consumes one private digest-bound standby candidate without cloning in the next warm commit", async () => {
    let documentCreations = 0
    const persistence = new MemoryPersistence()
    persistence.fastHeadVerification = true
    const kernel = await openKernel(persistence, {
      createDocument: () => {
        documentCreations += 1
        return new Y.Doc()
      },
    })
    await commit(kernel, "standby-base", id(130))
    expect(persistence.materializationEvidence?.work).toEqual({
      fullUpdateEncodes: 0,
      historicalBytesVisited: 0,
      candidateFullClones: 0,
    })
    const afterStandbyBuild = documentCreations
    await commit(kernel, "standby-consumed", id(131))
    expect(documentCreations).toBe(afterStandbyBuild)
    expect(persistence.materializationEvidence?.work).toEqual({
      fullUpdateEncodes: 0,
      historicalBytesVisited: 0,
      candidateFullClones: 0,
    })
    expect(persistence.hotFullUpdateEncodes).toBe(0)
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
    expect(documentCreations).toBe(beforeFallback + 2)
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
    expect(documentCreations).toBe(beforeFallback + 2)
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
    }
    expect(privateKernel.standbyCandidate).not.toBeNull()
    persistence.failAt = "atomic"
    await expect(commit(kernel, "standby-crash", id(138))).rejects.toThrow("atomic crash")
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(privateKernel.standbyCandidate).toBeNull()
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
    expect(documentCreations).toBe(beforeFallback + 2)
    kernel.dispose()
  })

  test("discards standby materialization-digest binding drift and falls back to an exact clone", async () => {
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
      standbyCandidate: { materializationDigest: Digest } | null
    }
    expect(privateKernel.standbyCandidate).not.toBeNull()
    privateKernel.standbyCandidate!.materializationDigest = parseDigest("01".repeat(32))
    const beforeFallback = documentCreations
    await commit(kernel, "standby-fulldigest-fallback", id(142))
    expect(documentCreations).toBe(beforeFallback + 2)
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
    expect(documentCreations).toBe(beforeFallback + 2)
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
    expect(documentCreations).toBe(beforeFallback + 2)
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
    expect(documentCreations).toBe(beforeFallback + 2)
    kernel.dispose()
  })

  test("rejects a second wrong-origin transaction in validatePost before durability", async () => {
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
    const persistence = new MemoryPersistence()
    const kernel = await openKernel(persistence, undefined, undefined, runtime)
    await expect(commit(kernel, "initial-value", id(124))).rejects.toThrow(
      "exactly one sealed transaction update",
    )
    expect(persistence.events).toEqual([])
    kernel.dispose()
  })

  test("does not let a post-validator mutation reach the retired flat canonicalizer or durability", async () => {
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
    await expect(commit(kernel, "force-fallback", id(127))).rejects.toThrow(
      "exactly one sealed transaction update",
    )
    expect(persistence.events).toEqual([])
    kernel.dispose()
  })

  test("does not invoke the retired flat canonicalizer before durability", async () => {
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
    const result = await commit(kernel, "canonicalizer-mutation", id(125))
    expect(result.status).toBe("saved-locally")
    expect(kernel.getProjectionSnapshot().canonicalStateDigest).toBe(canonicalStateDigestFor({ value: "canonicalizer-mutation" }))
    kernel.dispose()
  })

  test("rejects candidate client-id drift in validatePost before durability", async () => {
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
    const persistence = new MemoryPersistence()
    const kernel = await openKernel(persistence, undefined, undefined, runtime)
    await expect(commit(kernel, "client-drift", id(126))).rejects.toThrow(
      "exactly one sealed transaction update",
    )
    expect(persistence.events).toEqual([])
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
    await expect(commit(kernel, "original-client-struct", id(128))).rejects.toThrow("exact commitment-bound sealed state")
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

  test("uses one atomic persistence call for object, outbox, journal and sole-head before projection", async () => {
    const persistence = new MemoryPersistence()
    const projected: string[] = []
    const kernel = await openKernel(persistence, undefined, projected)
    const result = await commit(kernel, "one")
    expect(result.status).toBe("saved-locally")
    expect(persistence.events).toEqual(["atomic"])
    expect(persistence.atomicCommitCallCount).toBe(1)
    expect("fullUpdate" in persistence.lastCommitRequest!.expectedHead).toBe(false)
    expect(persistence.lastCommitRequest!.outboxRequirement).toBe(
      "replicate-exact-frame-until-acknowledged",
    )
    expect("putImmutableFrame" in persistence).toBe(false)
    expect("putReplicationOutboxRef" in persistence).toBe(false)
    expect("appendFrameJournal" in persistence).toBe(false)
    expect("compareAndCommitReplicaHead" in persistence).toBe(false)
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
        "head-check",
        "operation-lookup",
        "atomic-accepted-frame-commit",
        "owner-prepare",
        "projection",
        "queue",
        "reducer",
        "replica-apply",
        "sign",
      ].sort(),
    )
    expect(diagnostics[0]!.stages["atomic-accepted-frame-commit"].durationMs).toBeGreaterThanOrEqual(0)
    expect(diagnostics[0]!.stages["atomic-accepted-frame-commit"].callCount).toBe(1)
    expect(diagnostics[0]!.stages["canonical-delta-validation"].callCount).toBe(0)
    expect(diagnostics[0]!.stages["base-state-encode"].callCount).toBe(2)
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
    expect(persistence.events).toEqual(["atomic"])
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
    expect(withDiagnosticsPersistence.events).toEqual(["atomic"])
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

  test("post-fsync response loss is recovered inside the atomic port and never reported as failure", async () => {
    const persistence = new MemoryPersistence()
    persistence.loseResponseAfterAtomicCommit = true
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
    const first = await kernel.commitLocalIntent(request)
    expect(first.status).toBe("saved-locally")
    expect(persistence.responseLossRecoveredCount).toBe(1)
    expect(persistence.atomicCommitCallCount).toBe(2)
    expect(persistence.events).toEqual(["atomic", "atomic"])
    persistence.loseResponseAfterAtomicCommit = false
    const retry = await kernel.commitLocalIntent(request)
    expect(retry.status).toBe("duplicate")
    expect(prepareCount).toBe(1)
    expect(kernel.getProjectionSnapshot().canonicalStateDigest).toBe(
      canonicalStateDigestFor({ value: "committed-before-response" }),
    )
    const privateKernel = kernel as unknown as {
      standbyCandidate: object | null
    }
    expect(privateKernel.standbyCandidate).toBeNull()
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

  test("an atomic durability failure leaves no partial object, outbox, journal, head, or projection", async () => {
    const persistence = new MemoryPersistence()
    persistence.failAt = "atomic"
    const projected: string[] = []
    const kernel = await openKernel(persistence, undefined, projected)
    const before = kernel.getProjectionSnapshot()
    await expect(commit(kernel, "atomic")).rejects.toThrow("atomic crash")
    const after = kernel.getProjectionSnapshot()
    expect(after.canonicalStateDigest).toBe(before.canonicalStateDigest)
    expect(after.stateVector).toEqual(before.stateVector)
    expect(projected).toEqual([])
    expect(persistence.objects.size).toBe(0)
    expect(persistence.accepted.size).toBe(0)
    persistence.failAt = null
    const retry = await commit(kernel, "retry-atomic")
    expect(retry.status).toBe("saved-locally")
    kernel.dispose()
  })

  test("a stale sole durable head discards the candidate", async () => {
    const persistence = new MemoryPersistence()
    persistence.stale = true
    const kernel = await openKernel(persistence)
    const before = kernel.getProjectionSnapshot()
    await expect(commit(kernel, "stale")).rejects.toMatchObject({ code: "equivocation-quarantine" })
    expect(kernel.getProjectionSnapshot().stateVector).toEqual(before.stateVector)
    kernel.dispose()
  })

  test("the successful atomic retry preserves the one exact final frame", async () => {
    const persistence = new MemoryPersistence()
    persistence.failAt = "atomic"
    const kernel = await openKernel(persistence)
    const idValue = parseId128(encodeBase64url(Uint8Array.from({ length: 16 }, (_, i) => i * 7 + 1)))
    await expect(commit(kernel, "crash-atomic", idValue)).rejects.toThrow("atomic crash")
    persistence.failAt = null
    const retry = await commit(kernel, "recover-atomic", idValue)
    expect(retry.status).toBe("saved-locally")
    const storedRef = persistence.refsByDigest.get(retry.frame.frameDigest)
    expect(storedRef).toBeDefined()
    expect(persistence.objects.get(retry.frame.frameDigest)).toEqual(retry.frame.bytes)
    kernel.dispose()
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
    expect(receiverStore.events).toEqual(["atomic"])
    expect(projected).toEqual([firstFrame.frameDigest])
    expect((await receiver.receiveFrame(secondFrame.bytes)).status).toBe("accepted")
    expect(receiverStore.events).toEqual(["atomic", "atomic"])
    expect(projected).toEqual([firstFrame.frameDigest, secondFrame.frameDigest])
    expect(receiver.getProjectionSnapshot().canonicalStateDigest).toBe(canonicalStateDigestFor({ value: "two" }))
    const privateReceiver = receiver as unknown as {
      standbyCandidate: object | null
    }
    expect(privateReceiver.standbyCandidate).not.toBeNull()
    const creationsBeforeWarmLocal = receiverDocumentCreations
    expect((await commit(receiver, "three", id(153))).status).toBe("saved-locally")
    expect(receiverStore.materializationEvidence?.work).toEqual({
      fullUpdateEncodes: 0,
      historicalBytesVisited: 0,
      candidateFullClones: 0,
    })
    expect(receiverDocumentCreations).toBe(creationsBeforeWarmLocal)
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
    expect(receiverStore.events).toEqual(["atomic"])
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

function replaceAsciiOnce(bytes: Uint8Array, from: string, to: string): Uint8Array {
  const source = encoder.encode(from)
  const replacement = encoder.encode(to)
  if (source.byteLength !== replacement.byteLength) throw new Error("replacement must preserve byte length")
  const result = Uint8Array.from(bytes)
  const index = result.findIndex((byte, offset) =>
    byte === source[0] && source.every((candidate, inner) => result[offset + inner] === candidate),
  )
  if (index < 0) throw new Error(`missing encoded value: ${from}`)
  result.set(replacement, index)
  return result
}

function canonicalStateDigestFor(value: unknown) {
  const issuer = createOwnerStateCommitmentIssuer({ owner: "canvas", ownerSchemaDigest: SCHEMA })
  const root = value as Record<string, unknown>
  return issuer.digest(issuer.build({
    descriptor: CANONICALIZER_DESCRIPTOR.stateCommitment,
    scalars: [{ name: "format", value: CANONICAL_STATE_FORMAT }],
    collections: [{
      name: "root",
      entries: Object.entries(root).map(([key, entryValue]) => ({ key, value: entryValue })),
    }],
  }))
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

function operationId(value: number): Id128 {
  const bytes = new Uint8Array(16)
  new DataView(bytes.buffer).setUint32(12, value)
  return parseId128(encodeBase64url(bytes))
}
