import type * as Y from "yjs"
import { assertCurrentProtocolAuthority, type CurrentProtocolAuthority } from "./authority"
import { consumeCanonicalJcsEvidence, createCanonicalJcsEvidenceIssuer, type CanonicalJcsEvidence } from "./canonical-jcs-evidence"
import { cloneBytes } from "./binary"
import { assertDocumentOwnerBinding } from "./canonicalizer"
import { parseDigest, type Digest } from "./codecs"
import type {
  CreateOwnerExternalFactAttemptPortResult,
  DocumentOwnerKind,
  DocumentOwnerProtocolDefinition,
  DocumentOwnerProtocolPort,
  DocumentOwnerRuntime,
  OwnerApplyResult,
  OwnerExternalFactPortFactory,
  OwnerExternalFactPort,
  OwnerExternalFactRequirement,
  OwnerHistoryMaterializationPort,
  OwnerIntentClosureDefinition,
  OwnerIntentClosurePort,
  OwnerIntentDependencies,
  OwnerProcessValueFactory,
  OwnerValidatedState,
  SelectedDocumentOwnerArtifactDefinition,
  SelectedDocumentOwnerArtifactFactory,
  ValidationArtifactRef,
} from "./contracts"
import { ordinarySha256 } from "./digest"
import { CollaborationKernelError } from "./errors"
import {
  createOwnerStateCommitmentIssuer,
  inspectOwnerStateCommitment,
  ownerStateCommitmentDescriptorDigest,
  type OwnerStateCommitment,
} from "./owner-state-commitment"

const OWNER_FACT_ARTIFACT_LIMIT = 64
const OWNER_FACT_LIMIT = 64
const OWNER_FACT_REQUEST_LIMIT = 64 * 1024
const OWNER_FACT_REQUEST_TOTAL_LIMIT = 1024 * 1024
const OWNER_FACT_KIND = /^[a-z][a-z0-9.-]{0,127}$/u

interface OwnerRuntimeRecord {
  readonly owner: DocumentOwnerKind
  readonly authority: CurrentProtocolAuthority
  readonly factoryIdentity: object
  readonly canonicalJcs: ReturnType<typeof createCanonicalJcsEvidenceIssuer>
  readonly stateCommitment: ReturnType<typeof createOwnerStateCommitmentIssuer>
  readonly protocolPort: object
  readonly closurePort: object
  readonly externalFactPortFactory: object
  readonly armCandidateTransactionCapture: ((input: never) => void) | undefined
  readonly installValidatedPostCache: ((input: never) => void) | undefined
  readonly readCertifiedCanonicalDigest: ((input: never) => unknown) | undefined
}

interface ProcessValueRecord {
  readonly owner: DocumentOwnerKind
  readonly factoryIdentity: object
  readonly kind: "state" | "result"
}

const liveFactories = new WeakSet<object>()
const liveRuntimes = new WeakMap<object, OwnerRuntimeRecord>()
const liveProtocolPorts = new WeakMap<object, OwnerRuntimeRecord>()
const liveClosurePorts = new WeakMap<object, OwnerRuntimeRecord>()
const liveExternalFactFactories = new WeakMap<object, OwnerRuntimeRecord>()
const liveExternalFactPorts = new WeakMap<object, OwnerRuntimeRecord>()
const liveProcessValues = new WeakMap<object, ProcessValueRecord>()
const documentGenerations = new WeakMap<object, { depth: number; generation: number }>()
const liveCanonicalEvidence = new WeakMap<object, Readonly<{ runtimeIdentity: object; document: object; generation: number; evidence: CanonicalJcsEvidence }>>()
const liveStateCommitments = new WeakMap<object, Readonly<{
  runtimeIdentity: object
  document: object
  generation: number
  commitment: OwnerStateCommitment
}>>()
const activeOwnerValidations = new WeakMap<object, object>()
const liveAcceptedReplicaApplyEvidence = new WeakMap<object, Readonly<{
  runtime: object
  target: object
  state: object
  scopeDigest: Digest
  canonicalStateDigest: Digest
  materializationDigest: Digest
  postStateVectorDigest: Digest
  yjsUpdateDigest: Digest
  generation: number
}>>()

function ensureDocumentGenerationTracker(document: Y.Doc): { depth: number; generation: number } {
  const existing = documentGenerations.get(document)
  if (existing) return existing
  const tracker = { depth: 0, generation: 0 }
  documentGenerations.set(document, tracker)
  document.on("beforeTransaction", () => { tracker.depth += 1 })
  document.on("afterTransaction", () => {
    tracker.depth = Math.max(0, tracker.depth - 1)
    tracker.generation += 1
  })
  document.on("destroy", () => documentGenerations.delete(document))
  return tracker
}

export function issueAcceptedReplicaApplyEvidence<K extends DocumentOwnerKind>(runtime: DocumentOwnerRuntime<K>, input: Readonly<{
  scopeDigest: Digest; target: object; state: OwnerValidatedState<K>; canonicalStateDigest: Digest; materializationDigest: Digest
  postStateVectorDigest: Digest; yjsUpdateDigest: Digest; generation: number
}>): object {
  const record = objectRecord(runtime, liveRuntimes, "A live selected document-owner runtime is required")
  const stateRecord = objectRecord(input.state, liveProcessValues, "Owner process value is structural, stale or belongs to another runtime")
  if (stateRecord.owner !== record.owner || stateRecord.factoryIdentity !== record.factoryIdentity || stateRecord.kind !== "state") invalid("Owner process value is structural, stale or belongs to another runtime")
  const evidence = Object.freeze({})
  liveAcceptedReplicaApplyEvidence.set(evidence, { runtime: runtime as object, target: input.target, state: input.state as object, scopeDigest: parseDigest(input.scopeDigest), canonicalStateDigest: parseDigest(input.canonicalStateDigest), materializationDigest: parseDigest(input.materializationDigest), postStateVectorDigest: parseDigest(input.postStateVectorDigest), yjsUpdateDigest: parseDigest(input.yjsUpdateDigest), generation: input.generation })
  return evidence
}

export function createSelectedDocumentOwnerArtifactFactory<K extends DocumentOwnerKind>(
  authority: CurrentProtocolAuthority,
  owner: K,
): SelectedDocumentOwnerArtifactFactory<K> {
  assertCurrentProtocolAuthority(authority)
  const artifactDigest = selectedArtifactDigest(authority, owner)

  const factory = Object.freeze({
    createRuntime(definition: SelectedDocumentOwnerArtifactDefinition<K>) {
      if (!isObject(definition) || definition.owner !== owner || typeof definition.createDefinitions !== "function") {
        return rejectedRuntime("owner-definition-mismatch")
      }
      const factoryIdentity = Object.freeze({})
      const canonicalJcs = createCanonicalJcsEvidenceIssuer()
      const stateCommitment = createOwnerStateCommitmentIssuer({ owner, ownerSchemaDigest: artifactDigest })
      let selectedStateCommitmentDescriptorDigest: Digest | undefined
      const processValues = Object.freeze({
        canonicalJcs,
        stateCommitment,
        wrapValidatedState(value: unknown): OwnerValidatedState<K> {
          const wrapped = Object.freeze({ owner, value }) as OwnerValidatedState<K>
          liveProcessValues.set(wrapped, { owner, factoryIdentity, kind: "state" })
          return wrapped
        },
        wrapApplyResult(value: unknown): OwnerApplyResult<K> {
          const wrapped = Object.freeze({ owner, value }) as OwnerApplyResult<K>
          liveProcessValues.set(wrapped, { owner, factoryIdentity, kind: "result" })
          return wrapped
        },
        bindCanonicalJcsEvidence(document: Y.Doc, state: OwnerValidatedState<K>, evidence: CanonicalJcsEvidence) {
          const stateRecord = objectRecord(state, liveProcessValues, "Owner process value is structural, stale or belongs to another runtime")
          const tracker = documentGenerations.get(document)
          if (
            stateRecord.owner === owner
            && stateRecord.kind === "state"
            && stateRecord.factoryIdentity === factoryIdentity
            && tracker
            && tracker.depth === 0
            && tracker.generation >= 1
          ) {
            liveCanonicalEvidence.set(state, { runtimeIdentity: factoryIdentity, document, generation: tracker.generation, evidence })
          }
          return state
        },
        bindStateCommitment(
          document: Y.Doc,
          state: OwnerValidatedState<K>,
          commitment: OwnerStateCommitment,
        ) {
          const stateRecord = objectRecord(state, liveProcessValues, "Owner process value is structural, stale or belongs to another runtime")
          const tracker = documentGenerations.get(document)
          const inspected = inspectOwnerStateCommitment(stateCommitment, commitment)
          if (
            stateRecord.owner !== owner ||
            stateRecord.kind !== "state" ||
            stateRecord.factoryIdentity !== factoryIdentity ||
            activeOwnerValidations.get(factoryIdentity) !== document ||
            !tracker ||
            tracker.depth !== 0 ||
            selectedStateCommitmentDescriptorDigest === undefined ||
            inspected === null ||
            inspected.owner !== owner ||
            inspected.ownerSchemaDigest !== artifactDigest ||
            inspected.descriptorDigest !== selectedStateCommitmentDescriptorDigest
          ) {
            invalid("Owner state commitment is not bound to the exact active validated state")
          }
          liveStateCommitments.set(state, {
            runtimeIdentity: factoryIdentity,
            document,
            generation: tracker.generation,
            commitment,
          })
          return state
        },
      }) as OwnerProcessValueFactory<K>
      let definitions: Readonly<{
        protocol: DocumentOwnerProtocolDefinition<K>
        closure: OwnerIntentClosureDefinition<K>
      }>
      try {
        definitions = definition.createDefinitions(processValues)
      } catch {
        return rejectedRuntime("owner-runtime-invalid")
      }
      if (!isObject(definitions) || !isObject(definitions.protocol) || !isObject(definitions.closure)) {
        return rejectedRuntime("owner-runtime-invalid")
      }
      if (definition.installValidatedPostCache !== undefined && typeof definition.installValidatedPostCache !== "function") return rejectedRuntime("owner-runtime-invalid")
      if (definition.armCandidateTransactionCapture !== undefined && typeof definition.armCandidateTransactionCapture !== "function") return rejectedRuntime("owner-runtime-invalid")
      if (definition.readCertifiedCanonicalDigest !== undefined && typeof definition.readCertifiedCanonicalDigest !== "function") return rejectedRuntime("owner-runtime-invalid")
      if (definitions.protocol.owner !== owner) return rejectedRuntime("owner-definition-mismatch")
      if (definitions.protocol.schemaDigest !== artifactDigest) return rejectedRuntime("owner-artifact-mismatch")
      try {
        const protocolPort = createProtocolPort(definitions.protocol, owner, factoryIdentity)
        assertDocumentOwnerBinding(protocolPort)
        selectedStateCommitmentDescriptorDigest = ownerStateCommitmentDescriptorDigest(
          protocolPort.canonicalizerDescriptor.stateCommitment,
        )
        const runtimeRecordShell = {
          owner,
          authority,
          factoryIdentity,
          canonicalJcs,
          stateCommitment,
          protocolPort,
          closurePort: Object.freeze({}),
          externalFactPortFactory: Object.freeze({}),
          armCandidateTransactionCapture: undefined,
          installValidatedPostCache: undefined,
          readCertifiedCanonicalDigest: undefined,
        }
        const externalFactPortFactory = createExternalFactPortFactory(owner, factoryIdentity, runtimeRecordShell)
        const closurePort = createClosurePort(definitions.closure, protocolPort, owner, factoryIdentity, runtimeRecordShell)
        const record: OwnerRuntimeRecord = Object.freeze({ owner, authority, factoryIdentity, canonicalJcs, stateCommitment, protocolPort, closurePort, externalFactPortFactory, armCandidateTransactionCapture: definition.armCandidateTransactionCapture, installValidatedPostCache: definition.installValidatedPostCache, readCertifiedCanonicalDigest: definition.readCertifiedCanonicalDigest })
        const runtime = Object.freeze({ artifactDigest, protocolPort, closurePort, externalFactPortFactory }) as DocumentOwnerRuntime<K>
        liveRuntimes.set(runtime, record)
        liveProtocolPorts.set(protocolPort, record)
        liveClosurePorts.set(closurePort, record)
        liveExternalFactFactories.set(externalFactPortFactory, record)
        return runtime
      } catch {
        return rejectedRuntime("owner-runtime-invalid")
      }
    },
  }) as SelectedDocumentOwnerArtifactFactory<K>
  liveFactories.add(factory)
  return factory
}

export function assertDocumentOwnerRuntime(
  runtime: unknown,
  authority?: CurrentProtocolAuthority,
): asserts runtime is DocumentOwnerRuntime {
  const record = objectRecord(runtime, liveRuntimes, "A live selected document-owner runtime is required")
  const selected = runtime as DocumentOwnerRuntime
  if (authority !== undefined) {
    assertCurrentProtocolAuthority(authority)
    if (record.authority !== authority) invalid("Document-owner runtime belongs to a different protocol authority")
  }
  if (
    selected.artifactDigest !== selectedArtifactDigest(record.authority, record.owner)
    || selected.protocolPort !== record.protocolPort
    || selected.closurePort !== record.closurePort
    || selected.externalFactPortFactory !== record.externalFactPortFactory
    || selected.closurePort.protocolPort !== selected.protocolPort
  ) invalid("Document-owner runtime closure is invalid")
}

export function installOwnerValidatedPostCache<K extends DocumentOwnerKind>(
  runtime: DocumentOwnerRuntime<K>,
  input: Readonly<{
    readonly scope: Parameters<NonNullable<SelectedDocumentOwnerArtifactDefinition<K>["installValidatedPostCache"]>>[0]["scope"]
    readonly source: Parameters<NonNullable<SelectedDocumentOwnerArtifactDefinition<K>["installValidatedPostCache"]>>[0]["source"]
    readonly target: Parameters<NonNullable<SelectedDocumentOwnerArtifactDefinition<K>["installValidatedPostCache"]>>[0]["target"]
    readonly state: OwnerValidatedState<K>
    readonly canonicalStateDigest: Parameters<NonNullable<SelectedDocumentOwnerArtifactDefinition<K>["installValidatedPostCache"]>>[0]["canonicalStateDigest"]
    readonly durableHeadDigest: Parameters<NonNullable<SelectedDocumentOwnerArtifactDefinition<K>["installValidatedPostCache"]>>[0]["durableHeadDigest"]
    readonly applyEvidence: object
    readonly scopeDigest: Digest
    readonly materializationDigest: Digest
    readonly postStateVectorDigest: Digest
    readonly yjsUpdateDigest: Digest
  }>,
): void {
  const record = objectRecord(runtime, liveRuntimes, "A live selected document-owner runtime is required")
  const stateRecord = objectRecord(input.state, liveProcessValues, "Owner process value is structural, stale or belongs to another runtime")
  if (stateRecord.owner !== record.owner || stateRecord.factoryIdentity !== record.factoryIdentity || stateRecord.kind !== "state") {
    invalid("Owner process value is structural, stale or belongs to another runtime")
  }
  const evidence = liveAcceptedReplicaApplyEvidence.get(input.applyEvidence)
  if (!evidence || evidence.runtime !== runtime || evidence.target !== input.target || evidence.state !== input.state || evidence.scopeDigest !== input.scopeDigest || evidence.canonicalStateDigest !== input.canonicalStateDigest || evidence.materializationDigest !== input.materializationDigest || evidence.postStateVectorDigest !== input.postStateVectorDigest || evidence.yjsUpdateDigest !== input.yjsUpdateDigest || evidence.generation < 1) return
  liveAcceptedReplicaApplyEvidence.delete(input.applyEvidence)
  record.installValidatedPostCache?.(input as never)
}

export function ownerUsesValidatedPostCache(runtime: DocumentOwnerRuntime): boolean {
  return objectRecord(runtime, liveRuntimes, "A live selected document-owner runtime is required").installValidatedPostCache !== undefined
}

export function readOwnerCertifiedCanonicalDigest<K extends DocumentOwnerKind>(
  runtime: DocumentOwnerRuntime<K>,
  input: Parameters<NonNullable<SelectedDocumentOwnerArtifactDefinition<K>["readCertifiedCanonicalDigest"]>>[0],
): Digest | null {
  const record = objectRecord(runtime, liveRuntimes, "A live selected document-owner runtime is required")
  const value = record.readCertifiedCanonicalDigest?.(input as never)
  return value === undefined || value === null ? null : parseDigest(value)
}

export function armOwnerCandidateTransactionCapture<K extends DocumentOwnerKind>(
  runtime: DocumentOwnerRuntime<K>,
  input: Readonly<{
    readonly base: OwnerValidatedState<K>
    readonly candidate: Parameters<NonNullable<SelectedDocumentOwnerArtifactDefinition<K>["armCandidateTransactionCapture"]>>[0]["candidate"]
    readonly context: Parameters<NonNullable<SelectedDocumentOwnerArtifactDefinition<K>["armCandidateTransactionCapture"]>>[0]["context"]
    readonly baseCanonicalProof?: Parameters<NonNullable<SelectedDocumentOwnerArtifactDefinition<K>["armCandidateTransactionCapture"]>>[0]["baseCanonicalProof"]
  }>,
): void {
  const record = objectRecord(runtime, liveRuntimes, "A live selected document-owner runtime is required")
  const stateRecord = objectRecord(input.base, liveProcessValues, "Owner process value is structural, stale or belongs to another runtime")
  if (stateRecord.owner !== record.owner || stateRecord.factoryIdentity !== record.factoryIdentity || stateRecord.kind !== "state") {
    invalid("Owner process value is structural, stale or belongs to another runtime")
  }
  ensureDocumentGenerationTracker(input.candidate)
  record.armCandidateTransactionCapture?.(input as never)
}

export function consumeOwnerCanonicalJcsEvidence<K extends DocumentOwnerKind>(
  runtime: DocumentOwnerRuntime<K>,
  document: Y.Doc,
  state: OwnerValidatedState<K>,
): Uint8Array | null {
  const runtimeRecord = objectRecord(runtime, liveRuntimes, "A live selected document-owner runtime is required")
  const stateRecord = objectRecord(state, liveProcessValues, "Owner process value is structural, stale or belongs to another runtime")
  const binding = liveCanonicalEvidence.get(state)
  const tracker = documentGenerations.get(document)
  if (!binding || !tracker || tracker.depth !== 0 || tracker.generation !== binding.generation
    || binding.runtimeIdentity !== runtimeRecord.factoryIdentity || binding.document !== document
    || stateRecord.factoryIdentity !== runtimeRecord.factoryIdentity) return null
  liveCanonicalEvidence.delete(state)
  return consumeCanonicalJcsEvidence(runtimeRecord.canonicalJcs, binding.evidence)?.bytes ?? null
}

/** Consumes the only current canonical-state authority: an issuer-bound root. */
export function consumeOwnerStateCommitmentDigest<K extends DocumentOwnerKind>(
  runtime: DocumentOwnerRuntime<K>,
  document: Y.Doc,
  state: OwnerValidatedState<K>,
): Digest | null {
  const runtimeRecord = objectRecord(runtime, liveRuntimes, "A live selected document-owner runtime is required")
  const stateRecord = objectRecord(state, liveProcessValues, "Owner process value is structural, stale or belongs to another runtime")
  const binding = liveStateCommitments.get(state)
  const tracker = documentGenerations.get(document)
  if (
    !binding ||
    !tracker ||
    tracker.depth !== 0 ||
    tracker.generation !== binding.generation ||
    binding.runtimeIdentity !== runtimeRecord.factoryIdentity ||
    binding.document !== document ||
    stateRecord.owner !== runtimeRecord.owner ||
    stateRecord.kind !== "state" ||
    stateRecord.factoryIdentity !== runtimeRecord.factoryIdentity
  ) return null
  const inspected = inspectOwnerStateCommitment(runtimeRecord.stateCommitment, binding.commitment)
  const descriptorDigest = ownerStateCommitmentDescriptorDigest(
    runtime.protocolPort.canonicalizerDescriptor.stateCommitment,
  )
  if (
    inspected === null ||
    inspected.owner !== runtimeRecord.owner ||
    inspected.ownerSchemaDigest !== runtime.protocolPort.schemaDigest ||
    inspected.descriptorDigest !== descriptorDigest
  ) return null
  liveStateCommitments.delete(state)
  return inspected.rootDigest
}

export function assertOwnerExternalFactPort(
  port: unknown,
  runtime: DocumentOwnerRuntime,
): asserts port is OwnerExternalFactPort {
  assertDocumentOwnerRuntime(runtime)
  const portRecord = objectRecord(port, liveExternalFactPorts, "A live owner external-fact attempt port is required")
  const runtimeRecord = liveRuntimes.get(runtime)!
  if (
    portRecord.authority !== runtimeRecord.authority
    || portRecord.owner !== runtimeRecord.owner
    || portRecord.protocolPort !== runtimeRecord.protocolPort
  ) invalid("Owner external-fact port belongs to a different runtime")
}

function createProtocolPort<K extends DocumentOwnerKind>(
  definition: DocumentOwnerProtocolDefinition<K>,
  owner: K,
  factoryIdentity: object,
): DocumentOwnerProtocolPort<K> {
  requireFunction(definition.decodeIntent)
  requireFunction(definition.validateBase)
  requireFunction(definition.applyIntent)
  requireFunction(definition.validatePost)
  requireFunction(definition.canonicalStateBytes)
  requireFunction(definition.deriveActualWriteEvidence)
  const port = Object.freeze({
    owner,
    schemaDigest: parseDigest(definition.schemaDigest),
    canonicalizerDescriptor: definition.canonicalizerDescriptor,
    canonicalizerDigest: parseDigest(definition.canonicalizerDigest),
    decodeIntent(exactJcs: Uint8Array) {
      return definition.decodeIntent(cloneBytes(exactJcs, "owner intent"))
    },
    validateBase(document: Parameters<DocumentOwnerProtocolDefinition<K>["validateBase"]>[0]) {
      return runOwnerValidation(factoryIdentity, document, () => definition.validateBase(document), owner)
    },
    applyIntent(
      base: OwnerValidatedState<K>,
      candidate: Parameters<DocumentOwnerProtocolDefinition<K>["applyIntent"]>[1],
      context: Parameters<DocumentOwnerProtocolDefinition<K>["applyIntent"]>[2],
      intent: unknown,
      externalFacts: OwnerExternalFactPort<K>,
    ) {
      requireProcessValue(base, owner, factoryIdentity, "state")
      const result = definition.applyIntent(base, candidate, context, intent, externalFacts)
      if (typeof result !== "string") requireProcessValue(result, owner, factoryIdentity, "result")
      return result
    },
    validatePost(
      base: OwnerValidatedState<K>,
      candidate: Parameters<DocumentOwnerProtocolDefinition<K>["validatePost"]>[1],
      result: OwnerApplyResult<K>,
    ) {
      requireProcessValue(base, owner, factoryIdentity, "state")
      requireProcessValue(result, owner, factoryIdentity, "result")
      return runOwnerValidation(
        factoryIdentity,
        candidate,
        () => definition.validatePost(base, candidate, result),
        owner,
      )
    },
    canonicalStateBytes(document: Parameters<DocumentOwnerProtocolDefinition<K>["canonicalStateBytes"]>[0]) {
      const result = definition.canonicalStateBytes(document)
      return typeof result === "string" ? result : cloneBytes(result, "owner canonical-state bytes")
    },
    deriveActualWriteEvidence(result: OwnerApplyResult<K>) {
      requireProcessValue(result, owner, factoryIdentity, "result")
      return definition.deriveActualWriteEvidence(result)
    },
  }) as DocumentOwnerProtocolPort<K>
  return port
}

function runOwnerValidation<K extends DocumentOwnerKind>(
  factoryIdentity: object,
  document: Y.Doc,
  validate: () => OwnerValidatedState<K> | "pending" | "rejected",
  owner: K,
): OwnerValidatedState<K> | "pending" | "rejected" {
  if (activeOwnerValidations.has(factoryIdentity)) invalid("Owner validation cannot be re-entered")
  const tracker = ensureDocumentGenerationTracker(document)
  if (tracker.depth !== 0) invalid("Owner validation cannot run inside a Yjs transaction")
  activeOwnerValidations.set(factoryIdentity, document)
  try {
    const result = validate()
    if (typeof result === "string") return result
    requireProcessValue(result, owner, factoryIdentity, "state")
    const binding = liveStateCommitments.get(result)
    if (
      !binding ||
      binding.runtimeIdentity !== factoryIdentity ||
      binding.document !== document ||
      binding.generation !== tracker.generation ||
      tracker.depth !== 0
    ) {
      invalid("Owner validation did not return its exact commitment-bound sealed state")
    }
    return result
  } finally {
    activeOwnerValidations.delete(factoryIdentity)
  }
}

function createClosurePort<K extends DocumentOwnerKind>(
  definition: OwnerIntentClosureDefinition<K>,
  protocolPort: DocumentOwnerProtocolPort<K>,
  owner: K,
  factoryIdentity: object,
  recordShell: OwnerRuntimeRecord,
): OwnerIntentClosurePort<K> {
  requireFunction(definition.inspectIntent)
  requireFunction(definition.discoverDependencies)
  let history: OwnerHistoryMaterializationPort<K> | null = null
  if (definition.history !== null) {
    if (!isObject(definition.history)) invalid("Owner history definition is invalid")
    requireFunction(definition.history.discoverDependencies)
    requireFunction(definition.history.materialize)
    const historyDefinition = definition.history
    history = Object.freeze({
      discoverDependencies(input: Parameters<OwnerHistoryMaterializationPort<K>["discoverDependencies"]>[0]) {
        requireProcessValue(input.base, owner, factoryIdentity, "state")
        return historyDefinition.discoverDependencies(input)
      },
      materialize(input: Parameters<OwnerHistoryMaterializationPort<K>["materialize"]>[0]) {
        requireProcessValue(input.base, owner, factoryIdentity, "state")
        requireLiveFactPort(input.externalFacts, recordShell)
        return historyDefinition.materialize(input)
      },
    }) as OwnerHistoryMaterializationPort<K>
  }
  return Object.freeze({
    protocolPort,
    inspectIntent: definition.inspectIntent.bind(definition),
    discoverDependencies: definition.discoverDependencies.bind(definition),
    history,
  }) as OwnerIntentClosurePort<K>
}

function createExternalFactPortFactory<K extends DocumentOwnerKind>(
  owner: K,
  _factoryIdentity: object,
  recordShell: OwnerRuntimeRecord,
): OwnerExternalFactPortFactory<K> {
  return Object.freeze({
    createAttemptPort(input: Parameters<OwnerExternalFactPortFactory<K>["createAttemptPort"]>[0]): CreateOwnerExternalFactAttemptPortResult<K> {
      if (input.resolver.owner !== owner) return Object.freeze({ status: "rejected", code: "wrong-owner" })
      const normalized = normalizeDependencies(input.declared, owner)
      if (typeof normalized === "string") return Object.freeze({ status: "rejected", code: normalized })
      const consumedArtifacts = new Map<string, ValidationArtifactRef>()
      const consumedFacts = new Map<string, OwnerExternalFactRequirement<K>>()
      const declaredArtifacts = new Map(normalized.validationArtifacts.map((ref) => [artifactKey(ref), ref]))
      const declaredFacts = new Map(normalized.externalFacts.map((requirement) => [factKey(requirement), requirement]))
      const port = Object.freeze({
        resolveArtifact(ref: ValidationArtifactRef) {
          const key = artifactKey(ref)
          const declared = declaredArtifacts.get(key)
          if (!declared) return Object.freeze({ status: "rejected", code: "artifact-not-declared" as const })
          const result = input.resolver.resolveArtifact(declared)
          if (result.status === "resolved") {
            if (artifactKey(result.ref) !== key) return Object.freeze({ status: "rejected", code: "artifact-invalid" as const })
            consumedArtifacts.set(key, declared)
            return Object.freeze({ ...result, ref: declared, exactBytes: cloneBytes(result.exactBytes, "validation artifact") })
          }
          if (result.status === "pending" && artifactKey(result.ref) !== key) {
            return Object.freeze({ status: "rejected", code: "artifact-invalid" as const })
          }
          return result
        },
        resolveFact(requirement: OwnerExternalFactRequirement<K>) {
          const key = factKey(requirement)
          const declared = declaredFacts.get(key)
          if (!declared) return Object.freeze({ status: "rejected", code: "fact-not-declared" as const })
          const result = input.resolver.resolveFact(declared)
          if (result.status === "resolved") {
            if (factKey(result.requirement) !== key) return Object.freeze({ status: "rejected", code: "fact-invalid" as const })
            consumedFacts.set(key, declared)
            return Object.freeze({ ...result, requirement: declared })
          }
          if (result.status === "pending" && factKey(result.requirement) !== key) {
            return Object.freeze({ status: "rejected", code: "fact-invalid" as const })
          }
          return result
        },
        consumedDependencies(): OwnerIntentDependencies<K> {
          return Object.freeze({
            validationArtifacts: Object.freeze(normalized.validationArtifacts.filter((ref) => consumedArtifacts.has(artifactKey(ref)))),
            externalFacts: Object.freeze(normalized.externalFacts.filter((requirement) => consumedFacts.has(factKey(requirement)))),
          })
        },
      }) as OwnerExternalFactPort<K>
      liveExternalFactPorts.set(port, recordShell)
      return Object.freeze({ status: "created", port })
    },
  }) as OwnerExternalFactPortFactory<K>
}

function normalizeDependencies<K extends DocumentOwnerKind>(
  value: OwnerIntentDependencies<K>,
  owner: K,
): OwnerIntentDependencies<K> | Exclude<CreateOwnerExternalFactAttemptPortResult<K>, { status: "created" }>["code"] {
  if (!isObject(value) || !Array.isArray(value.validationArtifacts) || !Array.isArray(value.externalFacts)) return "dependency-invalid"
  if (value.validationArtifacts.length > OWNER_FACT_ARTIFACT_LIMIT || value.externalFacts.length > OWNER_FACT_LIMIT) return "dependency-cap-exceeded"
  let requestBytes = 0
  try {
    for (const ref of value.validationArtifacts) artifactKey(ref)
    for (const requirement of value.externalFacts) {
      if (requirement.owner !== owner || !OWNER_FACT_KIND.test(requirement.kind)) return "dependency-invalid"
      const bytes = cloneBytes(requirement.request.exactJcs, "external-fact request")
      if (bytes.byteLength > OWNER_FACT_REQUEST_LIMIT || ordinarySha256(bytes) !== requirement.request.sha256) return "dependency-invalid"
      requestBytes += bytes.byteLength
    }
  } catch {
    return "dependency-invalid"
  }
  if (requestBytes > OWNER_FACT_REQUEST_TOTAL_LIMIT) return "dependency-cap-exceeded"
  const artifactKeys = value.validationArtifacts.map(artifactKey)
  const factKeys = value.externalFacts.map(factKey)
  if (hasDuplicate(artifactKeys) || hasDuplicate(factKeys)) return "dependency-duplicate"
  if (!isStrictlySorted(artifactKeys) || !isStrictlySorted(factKeys)) return "dependency-order-invalid"
  return Object.freeze({
    validationArtifacts: Object.freeze(value.validationArtifacts.map((ref) => Object.freeze({ ...ref }))),
    externalFacts: Object.freeze(value.externalFacts.map((requirement) => Object.freeze({
      ...requirement,
      request: Object.freeze({ ...requirement.request, exactJcs: cloneBytes(requirement.request.exactJcs, "external-fact request") }),
    }))),
  })
}

function artifactKey(value: ValidationArtifactRef): string {
  return `${value.owner}\u0000${value.format}\u0000${value.artifactDigest}`
}

function factKey<K extends DocumentOwnerKind>(value: OwnerExternalFactRequirement<K>): string {
  return `${value.owner}\u0000${value.kind}\u0000${value.request.sha256}\u0000${value.factDigest}`
}

function selectedArtifactDigest(authority: CurrentProtocolAuthority, owner: DocumentOwnerKind) {
  const name = owner === "canvas" ? "canvas-schema" : "project-persistence"
  const artifact = authority.protocolSchemaBundle.core.artifacts.find((candidate) => candidate.name === name)
  if (!artifact) invalid("Selected owner artifact is unavailable")
  return artifact.artifactDigest
}

function requireProcessValue(value: object, owner: DocumentOwnerKind, factoryIdentity: object, kind: ProcessValueRecord["kind"]): void {
  const record = liveProcessValues.get(value)
  if (!record || record.owner !== owner || record.factoryIdentity !== factoryIdentity || record.kind !== kind) {
    invalid("Owner process value is structural, stale or belongs to another runtime")
  }
}

function requireLiveFactPort(value: object, recordShell: OwnerRuntimeRecord): void {
  const record = liveExternalFactPorts.get(value)
  if (record !== recordShell && record?.protocolPort !== recordShell.protocolPort) invalid("Owner external-fact port belongs to another runtime")
}

function objectRecord<T>(value: unknown, registry: WeakMap<object, T>, message: string): T {
  if (!isObject(value)) invalid(message)
  const record = registry.get(value)
  if (!record) invalid(message)
  return record
}

function rejectedRuntime(code: "owner-definition-mismatch" | "owner-artifact-mismatch" | "owner-runtime-invalid") {
  return Object.freeze({ status: "rejected" as const, code })
}

function requireFunction(value: unknown): asserts value is (...args: never[]) => unknown {
  if (typeof value !== "function") invalid("Owner runtime method is missing")
}

function isStrictlySorted(values: readonly string[]): boolean {
  return values.every((value, index) => index === 0 || values[index - 1]! < value)
}

function hasDuplicate(values: readonly string[]): boolean {
  return new Set(values).size !== values.length
}

function isObject(value: unknown): value is Record<PropertyKey, unknown> {
  return typeof value === "object" && value !== null
}

function invalid(message: string): never {
  throw new CollaborationKernelError("invalid-owner-result", message)
}
