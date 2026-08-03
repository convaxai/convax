import {
  assertPortablePluginStateValueV1,
  canonicalPortablePluginStateSchemaBytesV1,
  parsePortablePluginStateSchemaV1,
  pluginStateSchemaDigestInputV1,
  portablePluginStateSchemaFormat,
  type PortableBoundedValueSchemaV1,
} from "@convax/bounded-value"
import {
  assertDenseArrayV2,
  assertExactKeysV2,
  compareBytesV2,
  decodeRestrictedJcsV2,
  encodeRestrictedJcsV2,
  ordinarySha256V2,
  parseActorIdV2,
  parseDigestV2,
  parseDocumentScopeV2,
} from "@convax/collaboration"
import type {
  OwnerExternalFactPortV2,
  OwnerExternalFactRequirementV2,
  OwnerIntentDependenciesV2,
  OwnerIntentConstructionContextV2,
  OwnerIntentDependencyContextV2,
} from "@convax/collaboration"
import type {
  CanvasExternalFactContextV2,
  CanvasExternalFactKindV2,
  CanvasExternalFactRequestV2,
  CanvasExternalFactResultV2,
  CanvasResourceProofRefV2,
  CanvasTypedIntentUnionV2,
  GenerationBeginV2,
  PluginRequirementV2,
  PluginStateEnvelopeV2,
} from "./types"
import {
  assertGenerationBeginV2,
  assertGenerationRecoveryFailureV2,
  assertPluginRequirementV2,
  assertPluginStateV2,
  assertResourceProofV2,
  canvasDigestV2,
  sameCanonicalValueV2,
} from "./validation"

const FACT_REQUEST_LIMIT = 64 * 1024
const FACT_REQUEST_TOTAL_LIMIT = 1024 * 1024
const FACT_COUNT_LIMIT = 64

type DependencyDiscoveryResultV2 = OwnerIntentDependenciesV2<"canvas"> | "rejected"
type FactContextResultV2 = CanvasExternalFactContextV2 | "pending" | "rejected"

export function encodeCanvasExternalFactRequestV2(
  request: CanvasExternalFactRequestV2,
): Readonly<Uint8Array> | "rejected" {
  try {
    assertCanvasExternalFactRequestV2(request)
    return encodeRestrictedJcsV2(request)
  } catch {
    return "rejected"
  }
}

export function decodeCanvasExternalFactRequestV2(
  exactJcs: Readonly<Uint8Array>,
): CanvasExternalFactRequestV2 | "rejected" {
  try {
    const value = decodeRestrictedJcsV2(new Uint8Array(exactJcs))
    assertCanvasExternalFactRequestV2(value)
    return value
  } catch {
    return "rejected"
  }
}

export function validateCanvasExternalFactResultV2(value: unknown): CanvasExternalFactResultV2 | "rejected" {
  try {
    assertExactKeysV2(value, ["format", "kind", "requestSha256", "factDigest", "decision"], "Canvas external-fact result")
    if (value.format !== "convax.canvas-external-fact-result/2" || !isFactKind(value.kind) || value.decision !== "verified") {
      return "rejected"
    }
    return Object.freeze({
      format: value.format,
      kind: value.kind,
      requestSha256: parseDigestV2(value.requestSha256),
      factDigest: parseDigestV2(value.factDigest),
      decision: value.decision,
    })
  } catch {
    return "rejected"
  }
}

export function discoverCanvasIntentDependenciesV2(
  context: OwnerIntentDependencyContextV2,
  intent: CanvasTypedIntentUnionV2,
): DependencyDiscoveryResultV2 {
  return discoverCanvasValueDependenciesV2(context, intent)
}

/** Shared closed-value scanner used by ordinary intents and locally materialized history. */
export function discoverCanvasValueDependenciesV2(
  context: OwnerIntentConstructionContextV2,
  value: unknown,
): DependencyDiscoveryResultV2 {
  try {
    const resources: CanvasResourceProofRefV2[] = []
    const plugins: PluginRequirementV2[] = []
    const begins: GenerationBeginV2[] = []
    const recoveryProofDigests: string[] = []
    walkClosedIntentValue(value, (record) => {
      if (record.format === "convax.canvas-resource-proof-ref/2") {
        assertResourceProofV2(record, true)
        resources.push(record)
      } else if (record.format === "convax.canvas-generation-begin/2") {
        assertGenerationBeginV2(record)
        begins.push(record)
      } else if (record.format === "convax.canvas-generation-recovery-failure/2") {
        assertGenerationRecoveryFailureV2(record)
        recoveryProofDigests.push(record.proofDigest)
      }
      if (record.format === "convax.canvas-plugin-state/2") {
        assertPluginStateV2(record)
        plugins.push(Object.freeze({
          pluginId: record.pluginId,
          snapshotDigest: record.snapshotDigest,
          pluginStateSchemaDigest: record.pluginStateSchemaDigest,
          validationArtifact: record.validationArtifact,
        }))
      } else if (looksLikePluginRequirement(record)) {
        assertPluginRequirementV2(record)
        plugins.push(record)
      }
    })

    const validationArtifacts = uniqueSorted(plugins.map((plugin) => plugin.validationArtifact), encodeRestrictedJcsV2)
    const current = uniqueSorted(
      resources.filter((proof): proof is Extract<CanvasResourceProofRefV2, { mode: "current-owner-state" }> => proof.mode === "current-owner-state"),
      encodeRestrictedJcsV2,
    )
    const retained = uniqueSorted(
      resources.filter((proof): proof is Extract<CanvasResourceProofRefV2, { mode: "retained-canvas-history" }> => proof.mode === "retained-canvas-history"),
      encodeRestrictedJcsV2,
    )
    const requests: CanvasExternalFactRequestV2[] = [
      ...batchProofRequests("current-resources", current),
      ...batchProofRequests("retained-resources", retained),
      ...uniqueSorted(begins, encodeRestrictedJcsV2).map((begin) => generationBeginRequest(context, begin)),
      ...uniqueSorted(recoveryProofDigests.map(parseDigestV2), (digest) => encodeRestrictedJcsV2(digest)).map(
        (proofDigest) => ({ format: "convax.canvas-external-fact-request/2", kind: "generation-recovery", proofDigest }) as const,
      ),
    ]
    const externalFacts = requests.map(requirementFromRequest)
    const sortedFacts = [...externalFacts].sort((left, right) => compareBytesV2(requirementKey(left), requirementKey(right)))
    const totalBytes = sortedFacts.reduce((sum, requirement) => sum + requirement.request.exactJcs.byteLength, 0)
    if (sortedFacts.length > FACT_COUNT_LIMIT || totalBytes > FACT_REQUEST_TOTAL_LIMIT) return "rejected"
    return Object.freeze({
      validationArtifacts: Object.freeze(validationArtifacts),
      externalFacts: Object.freeze(sortedFacts),
    })
  } catch {
    return "rejected"
  }
}

/** Resolves and consumes the complete declared ledger before reducer mutation. */
export function createCanvasExternalFactContextV2(
  context: OwnerIntentConstructionContextV2,
  intent: CanvasTypedIntentUnionV2,
  port: OwnerExternalFactPortV2<"canvas">,
): FactContextResultV2 {
  const declared = discoverCanvasValueDependenciesV2(context, intent)
  if (declared === "rejected") return "rejected"
  const artifactSchemas = new Map<string, PortableBoundedValueSchemaV1>()
  for (const artifact of declared.validationArtifacts) {
    const result = port.resolveArtifact(artifact)
    if (result.status === "pending") return "pending"
    if (result.status === "rejected" || !sameCanonicalValueV2(result.ref, artifact)) return "rejected"
    try {
      if (artifact.owner !== "plugin" || artifact.format !== portablePluginStateSchemaFormat) return "rejected"
      const decoded = decodeRestrictedJcsV2(new Uint8Array(result.exactBytes))
      const schema = parsePortablePluginStateSchemaV1(decoded)
      const canonicalBytes = canonicalPortablePluginStateSchemaBytesV1(schema)
      if (compareBytesV2(canonicalBytes, result.exactBytes) !== 0) return "rejected"
      const schemaDigest = ordinarySha256V2(pluginStateSchemaDigestInputV1(schema))
      if (schemaDigest !== artifact.artifactDigest) return "rejected"
      artifactSchemas.set(bytesKey(encodeRestrictedJcsV2(artifact)), schema)
    } catch {
      return "rejected"
    }
  }
  const factResults = new Map<string, CanvasExternalFactResultV2>()
  for (const requirement of declared.externalFacts) {
    const resolved = port.resolveFact(requirement)
    if (resolved.status === "pending") return "pending"
    if (resolved.status === "rejected") return "rejected"
    const value = validateCanvasExternalFactResultV2(resolved.value)
    if (
      value === "rejected" ||
      value.kind !== requirement.kind ||
      value.requestSha256 !== requirement.request.sha256 ||
      value.factDigest !== requirement.factDigest
    ) return "rejected"
    factResults.set(bytesKey(requirementKey(requirement)), value)
  }

  const verifiedRequests = [...declared.externalFacts].map((requirement) => ({
    requirement,
    request: decodeCanvasExternalFactRequestV2(requirement.request.exactJcs),
  }))
  if (verifiedRequests.some((entry) => entry.request === "rejected")) return "rejected"
  return Object.freeze({
    validateCurrentResource(proof: CanvasResourceProofRefV2) {
      return verifiedRequests.some((entry) =>
        entry.request !== "rejected" &&
        (entry.request.kind === "current-resources" || entry.request.kind === "retained-resources") &&
        entry.request.proofs.some((candidate) => sameCanonicalValueV2(candidate, proof)) &&
        factResults.has(bytesKey(requirementKey(entry.requirement)))) ? "valid" : "invalid"
    },
    validatePluginArtifact(requirement: PluginRequirementV2) {
      const schema = artifactSchemas.get(bytesKey(encodeRestrictedJcsV2(requirement.validationArtifact)))
      return schema !== undefined && requirement.pluginStateSchemaDigest === requirement.validationArtifact.artifactDigest
        ? "valid"
        : "invalid"
    },
    validatePluginState(envelope: PluginStateEnvelopeV2) {
      const schema = artifactSchemas.get(bytesKey(encodeRestrictedJcsV2(envelope.validationArtifact)))
      if (schema === undefined || envelope.pluginStateSchemaDigest !== envelope.validationArtifact.artifactDigest) {
        return "invalid"
      }
      try {
        assertPortablePluginStateValueV1(schema, envelope.state)
        return "valid"
      } catch {
        return "invalid"
      }
    },
    validateGenerationBegin(begin: GenerationBeginV2) {
      const request = generationBeginRequest(context, begin)
      return hasVerifiedRequest(verifiedRequests, factResults, request) ? "valid" : "invalid"
    },
    validateGenerationRecovery(proofDigest: string) {
      const request = {
        format: "convax.canvas-external-fact-request/2",
        kind: "generation-recovery",
        proofDigest: parseDigestV2(proofDigest),
      } as const
      return hasVerifiedRequest(verifiedRequests, factResults, request) ? "valid" : "invalid"
    },
  })
}

function hasVerifiedRequest(
  entries: readonly { requirement: OwnerExternalFactRequirementV2<"canvas">; request: CanvasExternalFactRequestV2 | "rejected" }[],
  results: ReadonlyMap<string, CanvasExternalFactResultV2>,
  request: CanvasExternalFactRequestV2,
): boolean {
  return entries.some((entry) =>
    entry.request !== "rejected" &&
    sameCanonicalValueV2(entry.request, request) &&
    results.has(bytesKey(requirementKey(entry.requirement))))
}

function generationBeginRequest(
  context: OwnerIntentConstructionContextV2,
  begin: GenerationBeginV2,
): Extract<CanvasExternalFactRequestV2, { kind: "generation-begin" }> {
  return Object.freeze({
    format: "convax.canvas-external-fact-request/2",
    kind: "generation-begin",
    scope: context.scope,
    beginDigest: canvasDigestV2("convax.canvas-generation-begin/2", begin),
    beginActorId: begin.beginActorId,
    beginAuthorizationEpochDigest: begin.beginAuthorizationEpochDigest,
    toolRefDigest: begin.toolRefDigest,
    protocolDigest: context.protocolDigest,
  })
}

function batchProofRequests<K extends "current-resources" | "retained-resources">(
  kind: K,
  proofs: readonly (K extends "current-resources"
    ? Extract<CanvasResourceProofRefV2, { mode: "current-owner-state" }>
    : Extract<CanvasResourceProofRefV2, { mode: "retained-canvas-history" }>)[],
): CanvasExternalFactRequestV2[] {
  const result: CanvasExternalFactRequestV2[] = []
  let chunk: CanvasResourceProofRefV2[] = []
  for (const proof of proofs) {
    const candidate = [...chunk, proof]
    const request = { format: "convax.canvas-external-fact-request/2", kind, proofs: candidate }
    if (encodeRestrictedJcsV2(request).byteLength <= FACT_REQUEST_LIMIT) {
      chunk = candidate
      continue
    }
    if (chunk.length === 0) throw new TypeError("Canvas external-fact proof exceeds request cap")
    result.push({ format: "convax.canvas-external-fact-request/2", kind, proofs: Object.freeze(chunk) } as CanvasExternalFactRequestV2)
    chunk = [proof]
    if (encodeRestrictedJcsV2({ format: "convax.canvas-external-fact-request/2", kind, proofs: chunk }).byteLength > FACT_REQUEST_LIMIT)
      throw new TypeError("Canvas external-fact proof exceeds request cap")
  }
  if (chunk.length > 0)
    result.push({ format: "convax.canvas-external-fact-request/2", kind, proofs: Object.freeze(chunk) } as CanvasExternalFactRequestV2)
  return result
}

function requirementFromRequest(request: CanvasExternalFactRequestV2): OwnerExternalFactRequirementV2<"canvas"> {
  const exactJcs = encodeCanvasExternalFactRequestV2(request)
  if (exactJcs === "rejected" || exactJcs.byteLength > FACT_REQUEST_LIMIT) throw new TypeError("Canvas fact request is invalid")
  const sha256 = ordinarySha256V2(new Uint8Array(exactJcs))
  const factDigest = request.kind === "generation-begin"
    ? request.beginAuthorizationEpochDigest
    : request.kind === "generation-recovery"
      ? request.proofDigest
      : sha256
  return Object.freeze({
    owner: "canvas",
    kind: request.kind,
    factDigest,
    request: Object.freeze({ sha256, exactJcs: new Uint8Array(exactJcs) }),
  })
}

function assertCanvasExternalFactRequestV2(value: unknown): asserts value is CanvasExternalFactRequestV2 {
  assertExactKeysV2(value, requestKeys(value), "Canvas external-fact request")
  if (value.format !== "convax.canvas-external-fact-request/2" || !isFactKind(value.kind)) throw new TypeError("Invalid Canvas external-fact request")
  if (value.kind === "current-resources" || value.kind === "retained-resources") {
    assertDenseArrayV2(value.proofs, "Canvas resource proof batch")
    if (value.proofs.length === 0) throw new TypeError("Canvas resource proof batch is empty")
    const mode = value.kind === "current-resources" ? "current-owner-state" : "retained-canvas-history"
    let prior: Uint8Array | undefined
    for (const proof of value.proofs) {
      assertResourceProofV2(proof, true)
      if (proof.mode !== mode) throw new TypeError("Canvas resource proof mode does not match fact kind")
      const bytes = encodeRestrictedJcsV2(proof)
      if (prior !== undefined && compareBytesV2(prior, bytes) >= 0) throw new TypeError("Canvas resource proofs are not strict sorted")
      prior = bytes
    }
    return
  }
  if (value.kind === "generation-begin") {
    const scope = parseDocumentScopeV2(value.scope)
    if (scope.docKind !== "canvas") throw new TypeError("Generation fact scope is not Canvas")
    parseDigestV2(value.beginDigest)
    parseActorIdV2(value.beginActorId)
    parseDigestV2(value.beginAuthorizationEpochDigest)
    parseDigestV2(value.toolRefDigest)
    parseDigestV2(value.protocolDigest)
    return
  }
  parseDigestV2(value.proofDigest)
}

function requestKeys(value: unknown): readonly string[] {
  const kind = typeof value === "object" && value !== null ? (value as { kind?: unknown }).kind : undefined
  if (kind === "current-resources" || kind === "retained-resources") return ["format", "kind", "proofs"]
  if (kind === "generation-begin")
    return ["format", "kind", "scope", "beginDigest", "beginActorId", "beginAuthorizationEpochDigest", "toolRefDigest", "protocolDigest"]
  return ["format", "kind", "proofDigest"]
}

function isFactKind(value: unknown): value is CanvasExternalFactKindV2 {
  return value === "current-resources" || value === "retained-resources" || value === "generation-begin" || value === "generation-recovery"
}

function looksLikePluginRequirement(value: Record<string, unknown>): boolean {
  return "pluginId" in value && "snapshotDigest" in value && "pluginStateSchemaDigest" in value && "validationArtifact" in value
}

function walkClosedIntentValue(value: unknown, visit: (value: Record<string, unknown>) => void): void {
  if (Array.isArray(value)) {
    for (const item of value) walkClosedIntentValue(item, visit)
    return
  }
  if (typeof value !== "object" || value === null) return
  const record = value as Record<string, unknown>
  visit(record)
  for (const child of Object.values(record)) walkClosedIntentValue(child, visit)
}

function uniqueSorted<T>(values: readonly T[], encode: (value: T) => Uint8Array): T[] {
  const sorted = [...values].sort((left, right) => compareBytesV2(encode(left), encode(right)))
  return sorted.filter((value, index) => index === 0 || compareBytesV2(encode(sorted[index - 1]!), encode(value)) !== 0)
}

function requirementKey(requirement: OwnerExternalFactRequirementV2<"canvas">): Uint8Array {
  return encodeRestrictedJcsV2({
    owner: requirement.owner,
    kind: requirement.kind,
    factDigest: requirement.factDigest,
    request: { sha256: requirement.request.sha256, exactJcs: Array.from(requirement.request.exactJcs) },
  })
}

function bytesKey(bytes: Uint8Array): string {
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("")
}
