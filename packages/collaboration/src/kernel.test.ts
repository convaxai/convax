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
  type Id128,
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
import { createSelectedDocumentOwnerArtifactFactory } from "./owner-runtime"
import type {
  AcceptedHeadView,
  CollaborationKernelPorts,
  CollaborationPersistencePort,
  LocalFrameAuthority,
  OperationLookup,
} from "./ports"
import { encodeFullUpdate, encodeStateVector } from "./yjs-codec"
import { loadVerifiedTestAuthority } from "./authority.test-support"

const encoder = new TextEncoder()
const factPortFactories = new WeakMap<CollaborationKernel, () => OwnerExternalFactPort<"canvas">>()
const ID = parseId128(encodeBase64url(new Uint8Array(16)))
const ACTOR = parseActorId(encodeBase64url(Uint8Array.from({ length: 32 }, () => 7)))
const MEMBER = parseMemberId(encodeBase64url(Uint8Array.from({ length: 16 }, () => 8)))
const REPLICA = parseReplicaId("replica_0000002a")
const PUBLIC_KEY = parsePublicKey(encodeBase64url(Uint8Array.from({ length: 32 }, () => 2)))
const SIGNATURE = parseSignature(encodeBase64url(Uint8Array.from({ length: 64 }, (_, index) => index < 32 ? 3 : index === 32 ? 1 : 0)))
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
const SCOPE: DocumentScope = Object.freeze({ projectId: parseProjectId("project"), projectEpoch: ID, docKind: "canvas", docId: parseCanvasId(`cv_${"2".repeat(64)}`), shardEpoch: ID })

function authority(): Promise<CurrentProtocolAuthority> {
  return loadVerifiedTestAuthority()
}

function ownerDefinition(overrides?: Partial<ReturnType<SelectedDocumentOwnerArtifactDefinition<"canvas">["createDefinitions"]>>): SelectedDocumentOwnerArtifactDefinition<"canvas"> {
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
          return typeof value === "object" && value !== null && (value as { kind?: unknown }).kind === "set" ? value : "rejected" as const
        },
        validateBase(document: Y.Doc) {
          const keys = [...document.getMap("root").keys()]
          return keys.every((key) => key === "value")
            ? processValues.wrapValidatedState(document.getMap("root").toJSON())
            : "rejected" as const
        },
        applyIntent(candidate: Y.Doc, context: { intentDigest: typeof D1 }, intent: unknown) {
          const value = (intent as { value?: unknown }).value
          if (typeof value !== "string") return "rejected" as const
          candidate.getMap("root").set("value", value)
          return processValues.wrapApplyResult({ value, intentDigest: context.intentDigest })
        },
        validatePost(_base: unknown, candidate: Y.Doc) {
          return typeof candidate.getMap("root").get("value") === "string"
            ? processValues.wrapValidatedState(candidate.getMap("root").toJSON())
            : "rejected" as const
        },
        canonicalStateBytes(document: Y.Doc) { return canonicalStateBytes(document) },
        deriveActualWriteEvidence(result: { value: unknown }) {
          const { value, intentDigest } = result.value as { value: string; intentDigest: typeof D1 }
          return {
            format: "convax.actual-write-evidence" as const, scope: SCOPE, owner: "canvas" as const, ownerSchemaDigest: SCHEMA,
            intentDigest, changedPaths: ["root/value"],
            writes: [{ entityKind: "root", entityId: "root", field: "value", valueDigest: ordinarySha256(encoder.encode(value)) }],
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
  private pendingJournal: FrameObjectRef | null = null
  head: AcceptedHeadView

  constructor() {
    this.head = emptyHead()
  }

  async loadReplicaHead(): Promise<AcceptedHeadView> { return this.head }
  async putImmutableFrame(ref: FrameObjectRef, value: Uint8Array): Promise<void> {
    this.events.push("object")
    if (this.failAt === "object") throw new Error("object crash")
    this.objects.set(ref.frameDigest, Uint8Array.from(value)); this.refsByDigest.set(ref.frameDigest, ref)
  }
  async putReplicationOutboxRef(): Promise<void> { this.events.push("outbox"); if (this.failAt === "outbox") throw new Error("outbox crash") }
  async appendFrameJournal(ref: FrameObjectRef) {
    this.events.push("journal")
    if (this.failAt === "journal") throw new Error("journal crash")
    this.pendingJournal = ref
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
      ...this.head, headDigest, frontier, frontierDigest: causalFrontierDigest(frontier),
      actorHeads: { format: "convax.replica-actor-head-set", scope: SCOPE, heads: [causalHead] },
      fullUpdate: encodeFullUpdate(document), stateVector: encodeStateVector(document),
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
  async isReachableFromAcceptedHead(ref: FrameObjectRef): Promise<boolean> { return this.accepted.has(`${ref.actorId}:${ref.operationId}`) }
  async lookupOperation(actorId: string, operationId: string): Promise<OperationLookup> {
    const ref = this.accepted.get(`${actorId}:${operationId}`)
    if (ref) return { status: "accepted", ref, bytes: this.objects.get(ref.frameDigest)! }
    const recovery = [...this.refsByDigest.values()].find((item) => item.actorId === actorId && item.operationId === operationId)
    return recovery ? { status: "object-only-recovery", ref: recovery, bytes: this.objects.get(recovery.frameDigest)! } : { status: "absent" }
  }
  async scanDurableReferences(frameDigest: string) { return { complete: true, reachable: this.refsByDigest.has(frameDigest) } }
  async quarantineExactObject(): Promise<void> { this.events.push("quarantine") }
}

function emptyHead(): AcceptedHeadView {
  const doc = new Y.Doc()
  const frontier = Object.freeze({ format: "convax.causal-frontier" as const, heads: Object.freeze([]) })
  const result: AcceptedHeadView = Object.freeze({
    scope: SCOPE, headDigest: ordinarySha256(encoder.encode("genesis-head")), frontier,
    frontierDigest: causalFrontierDigest(frontier), actorHeads: Object.freeze({ format: "convax.replica-actor-head-set", scope: SCOPE, heads: Object.freeze([]) }),
    fullUpdate: encodeFullUpdate(doc), stateVector: encodeStateVector(doc), canonicalStateDigest: canonicalStateDigest(SCHEMA, canonicalStateBytes(doc)),
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
          actorId: ACTOR, actorSequence: parseUint64(last ? String(BigInt(last.actorSequence) + 1n) : "1"),
          predecessorFrameDigest: last?.frameDigest ?? null,
          signerAuthority: { kind: "team-replica", memberId: MEMBER, replicaId: REPLICA, actorId: ACTOR, memberAuthorizationEpoch: ID, replicaAuthorizationEpoch: ID, membershipSnapshotDigest: D1, replicaActorCredentialCoreDigest: D2, replicaEditAuthorizationCoreDigest: D3 },
          dependencies: [
            { kind: "membership-snapshot", digest: D1 }, { kind: "replica-actor-credential", digest: D2 }, { kind: "replica-edit-authorization", digest: D3 },
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
) {
  const base = ports(persistence)
  const selectedAuthority = await authority()
  const runtimeResult = ownerRuntime ?? createSelectedDocumentOwnerArtifactFactory(selectedAuthority, "canvas").createRuntime(ownerDefinition())
  if ("status" in runtimeResult) throw new Error(`owner runtime rejected: ${runtimeResult.code}`)
  const createFacts = () => emptyFacts(runtimeResult)
  const kernel = await CollaborationKernel.open({
    authority: selectedAuthority, scope: SCOPE, owner: runtimeResult,
    ports: {
      ...base,
      incomingFacts: { resolve: async () => ({ status: "resolved", port: createFacts() }) },
      ...override,
    }, signatureVerifier: { verify: async () => true },
    projection: projection ? { publish: ({ frameDigest }) => projection.push(frameDigest) } : undefined,
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
        return { ...definitions, protocol: { ...definitions.protocol, canonicalizerDescriptor: { ...CANONICALIZER_DESCRIPTOR, unexpected: true } } }
      },
    } as SelectedDocumentOwnerArtifactDefinition<"canvas">
    expect(createSelectedDocumentOwnerArtifactFactory(selectedAuthority, "canvas").createRuntime(tampered)).toEqual({ status: "rejected", code: "owner-runtime-invalid" })
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
    expect(createSelectedDocumentOwnerArtifactFactory(selectedAuthority, "canvas").createRuntime(stale)).toEqual({ status: "rejected", code: "owner-runtime-invalid" })
  })

  test("rejects wrong-format and defensively copies reused canonical-state bytes", async () => {
    const selectedAuthority = await authority()
    const definition = ownerDefinition()
    const wrongFormat = createSelectedDocumentOwnerArtifactFactory(selectedAuthority, "canvas").createRuntime({
      ...definition,
      createDefinitions(values) {
        const definitions = definition.createDefinitions(values)
        return { ...definitions, protocol: { ...definitions.protocol, canonicalStateBytes: () => encodeRestrictedJcs({ format: "convax.other-state" }) } }
      },
    })
    if ("status" in wrongFormat) throw new Error(wrongFormat.code)
    await expect(openKernel(new MemoryPersistence(), undefined, undefined, wrongFormat)).rejects.toThrow("wrong top-level format")
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
          return typeof result === "string" ? result : { ...result, validationArtifacts: { format: "convax.validation-artifact-set", artifacts: [] } }
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
    const persistence = new MemoryPersistence(); persistence.throwAfterHeadCommit = true
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
    expect(kernel.getProjectionSnapshot().canonicalStateDigest).toBe(canonicalStateDigestFor({ value: "committed-before-response" }))
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
        observed.push({ base: structuredClone(base.value), actorSequence: context.actorSequence, lamport: context.lamport })
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
    await expect(kernel.commitLocalIntent(request(id(94), "two"))).rejects.toThrow("reused across collaboration attempts")
    expect(persistence.events).toHaveLength(events)
    kernel.dispose()
  })

  for (const stage of ["object", "outbox", "journal", "head"] as const) {
    test(`crash at ${stage} leaves replicaDoc unchanged`, async () => {
      const persistence = new MemoryPersistence(); persistence.failAt = stage
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
        expect(kernel.getProjectionSnapshot().canonicalStateDigest).toBe(canonicalStateDigestFor({ value: `retry-${stage}` }))
      } else {
        expect(retry.status).toBe("recovered-final-frame")
        expect(kernel.getProjectionSnapshot().canonicalStateDigest).toBe(canonicalStateDigestFor({ value: stage }))
      }
      kernel.dispose()
    })
  }

  test("a stale sole durable head discards the candidate", async () => {
    const persistence = new MemoryPersistence(); persistence.stale = true
    const kernel = await openKernel(persistence)
    const before = kernel.getProjectionSnapshot()
    await expect(commit(kernel, "stale")).rejects.toMatchObject({ code: "equivocation-quarantine" })
    expect(kernel.getProjectionSnapshot().stateVector).toEqual(before.stateVector)
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
    const receiver = await openKernel(receiverStore, {
      exactBaseResolver: { reconstructExactBase: async (frame) => exactBases.get(frame.frameDigest)! },
      pendingInbox: { retainExactFrame: async (frame) => { pending.push(frame.frameDigest); return "retained" } },
      causalClosure: { contains: (descendant, ancestor) => descendant === secondFrame.frameDigest && ancestor === firstFrame.frameDigest },
    }, projected)
    expect((await receiver.receiveFrame(secondFrame.bytes)).status).toBe("dependency-pending")
    expect(pending).toEqual([secondFrame.frameDigest])
    expect((await receiver.receiveFrame(firstFrame.bytes)).status).toBe("accepted")
    expect(receiverStore.events).toEqual(["object", "outbox", "journal", "head"])
    expect(projected).toEqual([firstFrame.frameDigest])
    expect((await receiver.receiveFrame(secondFrame.bytes)).status).toBe("accepted")
    expect(receiverStore.events).toEqual(["object", "outbox", "journal", "head", "object", "outbox", "journal", "head"])
    expect(projected).toEqual([firstFrame.frameDigest, secondFrame.frameDigest])
    expect(receiver.getProjectionSnapshot().canonicalStateDigest).toBe(canonicalStateDigestFor({ value: "two" }))
    source.dispose(); receiver.dispose()
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
    await expect(cancelled.receiveFrame(authored.frame.bytes, controller.signal)).rejects.toMatchObject({ code: "cancelled" })
    expect(cancelled.getProjectionSnapshot().canonicalStateDigest).toBe(canonicalStateDigestFor({}))
    cancelled.dispose()
    source.dispose()
  })
})

function exactBase(frame: DecodedCausalEditFrame, prior: readonly DecodedCausalEditFrame[]) {
  const document = new Y.Doc()
  for (const item of prior) Y.applyUpdate(document, item.sections.yjsUpdate)
  const heads = prior.length === 0 ? [] : [headRef(prior.at(-1)!)]
  const value = {
    fullUpdate: encodeFullUpdate(document), stateVector: frame.sections.baseStateVector,
    frontier: frame.context.baseFrontier, actorHeads: { format: "convax.replica-actor-head-set" as const, scope: SCOPE, heads },
    canonicalStateDigest: frame.header.core.baseCanonicalStateDigest,
  }
  document.destroy()
  return value
}

function headRef(frame: DecodedCausalEditFrame) {
  const core = frame.header.core
  return { format: "convax.causal-head-ref" as const, actorId: core.actorId, actorSequence: core.actorSequence, frameDigest: frame.frameDigest, lamport: core.lamport }
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
      { owner: "canvas" as const, format: PROTOCOL_SCHEMA_ARTIFACTS[0].format, artifactDigest: parseDigest(PROTOCOL_SCHEMA_ARTIFACTS[0].artifactDigest) },
      { owner: "control-plane" as const, format: PROTOCOL_SCHEMA_ARTIFACTS[2].format, artifactDigest: parseDigest(PROTOCOL_SCHEMA_ARTIFACTS[2].artifactDigest) },
      { owner: "kernel" as const, format: PROTOCOL_SCHEMA_ARTIFACTS[1].format, artifactDigest: parseDigest(PROTOCOL_SCHEMA_ARTIFACTS[1].artifactDigest) },
      { owner: "project-index" as const, format: PROTOCOL_SCHEMA_ARTIFACTS[3].format, artifactDigest: parseDigest(PROTOCOL_SCHEMA_ARTIFACTS[3].artifactDigest) },
    ],
  }
}

function id(seed: number): Id128 {
  return parseId128(encodeBase64url(new Uint8Array(16).fill(seed)))
}
