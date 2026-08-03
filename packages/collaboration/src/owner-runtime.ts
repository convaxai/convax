import { assertVerifiedProtocolAuthorityV2, type VerifiedProtocolAuthorityV2 } from "./authority"
import { cloneBytesV2 } from "./binary"
import { assertDocumentOwnerBindingV2 } from "./canonicalizer"
import { parseDigestV2 } from "./codecs"
import type {
  CreateOwnerExternalFactAttemptPortResultV2,
  DocumentOwnerKindV2,
  DocumentOwnerProtocolDefinitionV2,
  DocumentOwnerProtocolPortV2,
  DocumentOwnerRuntimeV2,
  OwnerApplyResultV2,
  OwnerExternalFactPortFactoryV2,
  OwnerExternalFactPortV2,
  OwnerExternalFactRequirementV2,
  OwnerHistoryMaterializationPortV2,
  OwnerIntentClosureDefinitionV2,
  OwnerIntentClosurePortV2,
  OwnerIntentDependenciesV2,
  OwnerProcessValueFactoryV2,
  OwnerValidatedStateV2,
  SelectedDocumentOwnerArtifactDefinitionV2,
  SelectedDocumentOwnerArtifactFactoryV2,
  ValidationArtifactRefV2,
} from "./contracts"
import { ordinarySha256V2 } from "./digest"
import { CollaborationKernelErrorV2 } from "./errors"

const OWNER_FACT_ARTIFACT_LIMIT = 64
const OWNER_FACT_LIMIT = 64
const OWNER_FACT_REQUEST_LIMIT = 64 * 1024
const OWNER_FACT_REQUEST_TOTAL_LIMIT = 1024 * 1024
const OWNER_FACT_KIND = /^[a-z][a-z0-9.-]{0,127}$/u

interface OwnerRuntimeRecordV2 {
  readonly owner: DocumentOwnerKindV2
  readonly authority: VerifiedProtocolAuthorityV2
  readonly protocolPort: object
  readonly closurePort: object
  readonly externalFactPortFactory: object
}

interface ProcessValueRecordV2 {
  readonly owner: DocumentOwnerKindV2
  readonly factoryIdentity: object
  readonly kind: "state" | "result"
}

const liveFactories = new WeakSet<object>()
const liveRuntimes = new WeakMap<object, OwnerRuntimeRecordV2>()
const liveProtocolPorts = new WeakMap<object, OwnerRuntimeRecordV2>()
const liveClosurePorts = new WeakMap<object, OwnerRuntimeRecordV2>()
const liveExternalFactFactories = new WeakMap<object, OwnerRuntimeRecordV2>()
const liveExternalFactPorts = new WeakMap<object, OwnerRuntimeRecordV2>()
const liveProcessValues = new WeakMap<object, ProcessValueRecordV2>()

export function createSelectedDocumentOwnerArtifactFactoryV2<K extends DocumentOwnerKindV2>(
  authority: VerifiedProtocolAuthorityV2,
  owner: K,
): SelectedDocumentOwnerArtifactFactoryV2<K> {
  assertVerifiedProtocolAuthorityV2(authority)
  const artifactDigest = selectedArtifactDigest(authority, owner)
  const factoryIdentity = Object.freeze({})

  const processValues = Object.freeze({
    wrapValidatedState(value: unknown): OwnerValidatedStateV2<K> {
      const wrapped = Object.freeze({ owner, value }) as OwnerValidatedStateV2<K>
      liveProcessValues.set(wrapped, { owner, factoryIdentity, kind: "state" })
      return wrapped
    },
    wrapApplyResult(value: unknown): OwnerApplyResultV2<K> {
      const wrapped = Object.freeze({ owner, value }) as OwnerApplyResultV2<K>
      liveProcessValues.set(wrapped, { owner, factoryIdentity, kind: "result" })
      return wrapped
    },
  }) as OwnerProcessValueFactoryV2<K>

  const factory = Object.freeze({
    createRuntime(definition: SelectedDocumentOwnerArtifactDefinitionV2<K>) {
      if (!isObject(definition) || definition.owner !== owner || typeof definition.createDefinitions !== "function") {
        return rejectedRuntime("owner-definition-mismatch")
      }
      let definitions: Readonly<{
        protocol: DocumentOwnerProtocolDefinitionV2<K>
        closure: OwnerIntentClosureDefinitionV2<K>
      }>
      try {
        definitions = definition.createDefinitions(processValues)
      } catch {
        return rejectedRuntime("owner-runtime-invalid")
      }
      if (!isObject(definitions) || !isObject(definitions.protocol) || !isObject(definitions.closure)) {
        return rejectedRuntime("owner-runtime-invalid")
      }
      if (definitions.protocol.owner !== owner) return rejectedRuntime("owner-definition-mismatch")
      if (definitions.protocol.schemaDigest !== artifactDigest) return rejectedRuntime("owner-artifact-mismatch")
      try {
        const protocolPort = createProtocolPort(definitions.protocol, owner, factoryIdentity)
        assertDocumentOwnerBindingV2(protocolPort)
        const runtimeRecordShell = {
          owner,
          authority,
          protocolPort,
          closurePort: Object.freeze({}),
          externalFactPortFactory: Object.freeze({}),
        }
        const externalFactPortFactory = createExternalFactPortFactory(owner, factoryIdentity, runtimeRecordShell)
        const closurePort = createClosurePort(definitions.closure, protocolPort, owner, factoryIdentity, runtimeRecordShell)
        const record: OwnerRuntimeRecordV2 = Object.freeze({ owner, authority, protocolPort, closurePort, externalFactPortFactory })
        const runtime = Object.freeze({ artifactDigest, protocolPort, closurePort, externalFactPortFactory }) as DocumentOwnerRuntimeV2<K>
        liveRuntimes.set(runtime, record)
        liveProtocolPorts.set(protocolPort, record)
        liveClosurePorts.set(closurePort, record)
        liveExternalFactFactories.set(externalFactPortFactory, record)
        return runtime
      } catch {
        return rejectedRuntime("owner-runtime-invalid")
      }
    },
  }) as SelectedDocumentOwnerArtifactFactoryV2<K>
  liveFactories.add(factory)
  return factory
}

export function assertDocumentOwnerRuntimeV2(
  runtime: unknown,
  authority?: VerifiedProtocolAuthorityV2,
): asserts runtime is DocumentOwnerRuntimeV2 {
  const record = objectRecord(runtime, liveRuntimes, "A live selected document-owner runtime is required")
  const selected = runtime as DocumentOwnerRuntimeV2
  if (authority !== undefined) {
    assertVerifiedProtocolAuthorityV2(authority)
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

export function assertOwnerExternalFactPortV2(
  port: unknown,
  runtime: DocumentOwnerRuntimeV2,
): asserts port is OwnerExternalFactPortV2 {
  assertDocumentOwnerRuntimeV2(runtime)
  const portRecord = objectRecord(port, liveExternalFactPorts, "A live owner external-fact attempt port is required")
  const runtimeRecord = liveRuntimes.get(runtime)!
  if (
    portRecord.authority !== runtimeRecord.authority
    || portRecord.owner !== runtimeRecord.owner
    || portRecord.protocolPort !== runtimeRecord.protocolPort
  ) invalid("Owner external-fact port belongs to a different runtime")
}

function createProtocolPort<K extends DocumentOwnerKindV2>(
  definition: DocumentOwnerProtocolDefinitionV2<K>,
  owner: K,
  factoryIdentity: object,
): DocumentOwnerProtocolPortV2<K> {
  requireFunction(definition.decodeIntent)
  requireFunction(definition.validateBase)
  requireFunction(definition.applyIntent)
  requireFunction(definition.validatePost)
  requireFunction(definition.canonicalStateBytes)
  requireFunction(definition.deriveActualWriteEvidence)
  const port = Object.freeze({
    owner,
    schemaDigest: parseDigestV2(definition.schemaDigest),
    canonicalizerDescriptor: definition.canonicalizerDescriptor,
    canonicalizerDigest: parseDigestV2(definition.canonicalizerDigest),
    decodeIntent(exactJcs: Uint8Array) {
      return definition.decodeIntent(cloneBytesV2(exactJcs, "owner intent"))
    },
    validateBase(document: Parameters<DocumentOwnerProtocolDefinitionV2<K>["validateBase"]>[0]) {
      const result = definition.validateBase(document)
      if (typeof result !== "string") requireProcessValue(result, owner, factoryIdentity, "state")
      return result
    },
    applyIntent(
      candidate: Parameters<DocumentOwnerProtocolDefinitionV2<K>["applyIntent"]>[0],
      context: Parameters<DocumentOwnerProtocolDefinitionV2<K>["applyIntent"]>[1],
      intent: unknown,
      externalFacts: OwnerExternalFactPortV2<K>,
    ) {
      const result = definition.applyIntent(candidate, context, intent, externalFacts)
      if (typeof result !== "string") requireProcessValue(result, owner, factoryIdentity, "result")
      return result
    },
    validatePost(
      base: OwnerValidatedStateV2<K>,
      candidate: Parameters<DocumentOwnerProtocolDefinitionV2<K>["validatePost"]>[1],
      result: OwnerApplyResultV2<K>,
    ) {
      requireProcessValue(base, owner, factoryIdentity, "state")
      requireProcessValue(result, owner, factoryIdentity, "result")
      const value = definition.validatePost(base, candidate, result)
      if (typeof value !== "string") requireProcessValue(value, owner, factoryIdentity, "state")
      return value
    },
    canonicalStateBytes(document: Parameters<DocumentOwnerProtocolDefinitionV2<K>["canonicalStateBytes"]>[0]) {
      const result = definition.canonicalStateBytes(document)
      return typeof result === "string" ? result : cloneBytesV2(result, "owner canonical-state bytes")
    },
    deriveActualWriteEvidence(result: OwnerApplyResultV2<K>) {
      requireProcessValue(result, owner, factoryIdentity, "result")
      return definition.deriveActualWriteEvidence(result)
    },
  }) as DocumentOwnerProtocolPortV2<K>
  return port
}

function createClosurePort<K extends DocumentOwnerKindV2>(
  definition: OwnerIntentClosureDefinitionV2<K>,
  protocolPort: DocumentOwnerProtocolPortV2<K>,
  owner: K,
  factoryIdentity: object,
  recordShell: OwnerRuntimeRecordV2,
): OwnerIntentClosurePortV2<K> {
  requireFunction(definition.inspectIntent)
  requireFunction(definition.discoverDependencies)
  let history: OwnerHistoryMaterializationPortV2<K> | null = null
  if (definition.history !== null) {
    if (!isObject(definition.history)) invalid("Owner history definition is invalid")
    requireFunction(definition.history.discoverDependencies)
    requireFunction(definition.history.materialize)
    const historyDefinition = definition.history
    history = Object.freeze({
      discoverDependencies(input: Parameters<OwnerHistoryMaterializationPortV2<K>["discoverDependencies"]>[0]) {
        requireProcessValue(input.base, owner, factoryIdentity, "state")
        return historyDefinition.discoverDependencies(input)
      },
      materialize(input: Parameters<OwnerHistoryMaterializationPortV2<K>["materialize"]>[0]) {
        requireProcessValue(input.base, owner, factoryIdentity, "state")
        requireLiveFactPort(input.externalFacts, recordShell)
        return historyDefinition.materialize(input)
      },
    }) as OwnerHistoryMaterializationPortV2<K>
  }
  return Object.freeze({
    protocolPort,
    inspectIntent: definition.inspectIntent.bind(definition),
    discoverDependencies: definition.discoverDependencies.bind(definition),
    history,
  }) as OwnerIntentClosurePortV2<K>
}

function createExternalFactPortFactory<K extends DocumentOwnerKindV2>(
  owner: K,
  _factoryIdentity: object,
  recordShell: OwnerRuntimeRecordV2,
): OwnerExternalFactPortFactoryV2<K> {
  return Object.freeze({
    createAttemptPort(input: Parameters<OwnerExternalFactPortFactoryV2<K>["createAttemptPort"]>[0]): CreateOwnerExternalFactAttemptPortResultV2<K> {
      if (input.resolver.owner !== owner) return Object.freeze({ status: "rejected", code: "wrong-owner" })
      const normalized = normalizeDependencies(input.declared, owner)
      if (typeof normalized === "string") return Object.freeze({ status: "rejected", code: normalized })
      const consumedArtifacts = new Map<string, ValidationArtifactRefV2>()
      const consumedFacts = new Map<string, OwnerExternalFactRequirementV2<K>>()
      const declaredArtifacts = new Map(normalized.validationArtifacts.map((ref) => [artifactKey(ref), ref]))
      const declaredFacts = new Map(normalized.externalFacts.map((requirement) => [factKey(requirement), requirement]))
      const port = Object.freeze({
        resolveArtifact(ref: ValidationArtifactRefV2) {
          const key = artifactKey(ref)
          const declared = declaredArtifacts.get(key)
          if (!declared) return Object.freeze({ status: "rejected", code: "artifact-not-declared" as const })
          const result = input.resolver.resolveArtifact(declared)
          if (result.status === "resolved") {
            if (artifactKey(result.ref) !== key) return Object.freeze({ status: "rejected", code: "artifact-invalid" as const })
            consumedArtifacts.set(key, declared)
            return Object.freeze({ ...result, ref: declared, exactBytes: cloneBytesV2(result.exactBytes, "validation artifact") })
          }
          if (result.status === "pending" && artifactKey(result.ref) !== key) {
            return Object.freeze({ status: "rejected", code: "artifact-invalid" as const })
          }
          return result
        },
        resolveFact(requirement: OwnerExternalFactRequirementV2<K>) {
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
        consumedDependencies(): OwnerIntentDependenciesV2<K> {
          return Object.freeze({
            validationArtifacts: Object.freeze(normalized.validationArtifacts.filter((ref) => consumedArtifacts.has(artifactKey(ref)))),
            externalFacts: Object.freeze(normalized.externalFacts.filter((requirement) => consumedFacts.has(factKey(requirement)))),
          })
        },
      }) as OwnerExternalFactPortV2<K>
      liveExternalFactPorts.set(port, recordShell)
      return Object.freeze({ status: "created", port })
    },
  }) as OwnerExternalFactPortFactoryV2<K>
}

function normalizeDependencies<K extends DocumentOwnerKindV2>(
  value: OwnerIntentDependenciesV2<K>,
  owner: K,
): OwnerIntentDependenciesV2<K> | Exclude<CreateOwnerExternalFactAttemptPortResultV2<K>, { status: "created" }>["code"] {
  if (!isObject(value) || !Array.isArray(value.validationArtifacts) || !Array.isArray(value.externalFacts)) return "dependency-invalid"
  if (value.validationArtifacts.length > OWNER_FACT_ARTIFACT_LIMIT || value.externalFacts.length > OWNER_FACT_LIMIT) return "dependency-cap-exceeded"
  let requestBytes = 0
  try {
    for (const ref of value.validationArtifacts) artifactKey(ref)
    for (const requirement of value.externalFacts) {
      if (requirement.owner !== owner || !OWNER_FACT_KIND.test(requirement.kind)) return "dependency-invalid"
      const bytes = cloneBytesV2(requirement.request.exactJcs, "external-fact request")
      if (bytes.byteLength > OWNER_FACT_REQUEST_LIMIT || ordinarySha256V2(bytes) !== requirement.request.sha256) return "dependency-invalid"
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
      request: Object.freeze({ ...requirement.request, exactJcs: cloneBytesV2(requirement.request.exactJcs, "external-fact request") }),
    }))),
  })
}

function artifactKey(value: ValidationArtifactRefV2): string {
  return `${value.owner}\u0000${value.format}\u0000${value.artifactDigest}`
}

function factKey<K extends DocumentOwnerKindV2>(value: OwnerExternalFactRequirementV2<K>): string {
  return `${value.owner}\u0000${value.kind}\u0000${value.request.sha256}\u0000${value.factDigest}`
}

function selectedArtifactDigest(authority: VerifiedProtocolAuthorityV2, owner: DocumentOwnerKindV2) {
  const name = owner === "canvas" ? "canvas-schema" : "project-persistence"
  const artifact = authority.protocolSchemaBundle.core.artifacts.find((candidate) => candidate.name === name)
  if (!artifact) invalid("Selected owner artifact is unavailable")
  return artifact.artifactDigest
}

function requireProcessValue(value: object, owner: DocumentOwnerKindV2, factoryIdentity: object, kind: ProcessValueRecordV2["kind"]): void {
  const record = liveProcessValues.get(value)
  if (!record || record.owner !== owner || record.factoryIdentity !== factoryIdentity || record.kind !== kind) {
    invalid("Owner process value is structural, stale or belongs to another runtime")
  }
}

function requireLiveFactPort(value: object, recordShell: OwnerRuntimeRecordV2): void {
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
  throw new CollaborationKernelErrorV2("invalid-owner-result", message)
}
