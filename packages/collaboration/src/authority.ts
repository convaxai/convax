import { parseDigestV2, type DigestV2 } from "./codecs"
import {
  KERNEL_DIGEST_DOMAINS_V2,
  PINNED_AUTHORITY_IDENTITIES_V2,
  PROTOCOL_SCHEMA_ARTIFACTS_V2,
  PROTOCOL_TYPE_NAMESPACES_V2,
} from "./constants"
import type { ProtocolSchemaBundleCoreV2, ProtocolSchemaBundleV2 } from "./contracts"
import { structuredDigestV2 } from "./digest"
import { ProtocolAuthorityErrorV2 } from "./errors"
import { assertDenseArrayV2, assertExactKeysV2, encodeRestrictedJcsV2, isPlainDataObject, sameBytes } from "./jcs"

const validAuthorities = new WeakSet<object>()

/**
 * Process-local proof that the implementation selected by the exact R5 release is
 * installed. The shape is intentionally insufficient: every consumer also checks
 * the module-private live registry, so a structural clone has no authority.
 */
export interface VerifiedProtocolAuthorityV2 {
  readonly format: "convax.protocol-authority-verification/2"
  readonly authorityId: "collaboration-v10"
  readonly revision: "r5"
  readonly sequence: "1"
  readonly protocolDigest: DigestV2
  readonly artifactDigests: readonly DigestV2[]
  readonly protocolSchemaBundle: ProtocolSchemaBundleV2
}

/** Called only by the exact release selector after its copy-owning snapshot check. */
export function installVerifiedProtocolAuthorityV2(bundleValue: unknown): VerifiedProtocolAuthorityV2 {
  try {
    const protocolSchemaBundle = parseVerifiedBundle(bundleValue)
    const authority = Object.freeze({
      format: "convax.protocol-authority-verification/2" as const,
      authorityId: "collaboration-v10" as const,
      revision: "r5" as const,
      sequence: "1" as const,
      protocolDigest: protocolSchemaBundle.protocolDigest,
      artifactDigests: Object.freeze(protocolSchemaBundle.core.artifacts.map((artifact) => artifact.artifactDigest)),
      protocolSchemaBundle,
    })
    validAuthorities.add(authority)
    return authority
  } catch (error) {
    if (error instanceof ProtocolAuthorityErrorV2) throw error
    unavailable("The selected collaboration implementation cannot be installed", { cause: error })
  }
}

export function assertVerifiedProtocolAuthorityV2(value: unknown): asserts value is VerifiedProtocolAuthorityV2 {
  if (typeof value !== "object" || value === null || !validAuthorities.has(value)) {
    unavailable("A live selection of the exact R5 collaboration authority is required")
  }
}

function parseVerifiedBundle(value: unknown): ProtocolSchemaBundleV2 {
  assertExactKeysV2(value, ["core", "coreDigest", "format", "protocolDigest"], "ProtocolSchemaBundleV2")
  if (value.format !== "convax.protocol-schema-bundle/2") unavailable("ProtocolSchemaBundleV2 format is invalid")
  const core = parseVerifiedBundleCore(value.core)
  const coreDigest = structuredDigestV2(KERNEL_DIGEST_DOMAINS_V2.protocolSchemaBundleCore, core)
  requireEqual(coreDigest, PINNED_AUTHORITY_IDENTITIES_V2.protocolDigest, "ProtocolSchemaBundleV2 core digest")
  requireEqual(value.coreDigest, coreDigest, "ProtocolSchemaBundleV2 coreDigest")
  requireEqual(value.protocolDigest, coreDigest, "ProtocolSchemaBundleV2 protocolDigest")
  return Object.freeze({
    core,
    coreDigest,
    format: value.format,
    protocolDigest: coreDigest,
  })
}

function parseVerifiedBundleCore(value: unknown): ProtocolSchemaBundleCoreV2 {
  assertExactKeysV2(
    value,
    [
      "artifacts",
      "channelContractDigest",
      "domainRegistry",
      "format",
      "limitsDigest",
      "protocolMajor",
      "typeNamespaces",
      "uriProtocolDigest",
      "yjsWireCodec",
    ],
    "ProtocolSchemaBundleCoreV2",
  )
  if (value.format !== "convax.protocol-schema-bundle-core/2" || value.protocolMajor !== "2") {
    unavailable("ProtocolSchemaBundleV2 core discriminators are invalid")
  }
  if (!sameBytes(encodeRestrictedJcsV2(value.artifacts), encodeRestrictedJcsV2(PROTOCOL_SCHEMA_ARTIFACTS_V2))) {
    unavailable("ProtocolSchemaBundleV2 artifact tuple differs from R5")
  }
  if (!sameBytes(encodeRestrictedJcsV2(value.typeNamespaces), encodeRestrictedJcsV2(PROTOCOL_TYPE_NAMESPACES_V2))) {
    unavailable("ProtocolSchemaBundleV2 namespace tuple differs from R5")
  }
  assertDenseArrayV2(value.domainRegistry, "ProtocolSchemaBundleV2 domainRegistry")
  const domainRegistry = value.domainRegistry.map((domain) => {
    if (typeof domain !== "string" || !domain.endsWith("/2")) {
      unavailable("ProtocolSchemaBundleV2 has an invalid digest domain")
    }
    return domain
  })
  if (
    domainRegistry.length !== 127 ||
    domainRegistry.some((domain, index) => index > 0 && domainRegistry[index - 1]! >= domain)
  ) {
    unavailable("ProtocolSchemaBundleV2 domain registry is not the exact sorted R5 set")
  }
  if (!isPlainDataObject(value.yjsWireCodec)) unavailable("ProtocolSchemaBundleV2 Yjs codec is invalid")
  const yjsWireCodec = Object.freeze({
    applyCodec: requireLiteral(value.yjsWireCodec.applyCodec, "Y.applyUpdate", "Yjs apply codec"),
    format: requireLiteral(value.yjsWireCodec.format, "convax.yjs-wire-codec/2", "Yjs codec format"),
    package: requireLiteral(value.yjsWireCodec.package, "yjs", "Yjs package"),
    packageIntegrity: requireLiteral(
      value.yjsWireCodec.packageIntegrity,
      "sha512-Eq+5BRfbeGyqGVrTJL3bEcr8gKkxPuyuoHmAwpk52fDb8kOVMrfVSTRPd6yiGgX5Fskb96qCRjzjbRjrL4YEnw==",
      "Yjs integrity",
    ),
    stateVectorCodec: requireLiteral(value.yjsWireCodec.stateVectorCodec, "Y.encodeStateVector", "Yjs state-vector codec"),
    updateCodec: requireLiteral(value.yjsWireCodec.updateCodec, "Y.encodeStateAsUpdate", "Yjs update codec"),
    updateVersion: requireLiteral(value.yjsWireCodec.updateVersion, "v1", "Yjs update version"),
    version: requireLiteral(value.yjsWireCodec.version, "13.6.31", "Yjs version"),
  })
  return Object.freeze({
    artifacts: Object.freeze([
      Object.freeze({ ...PROTOCOL_SCHEMA_ARTIFACTS_V2[0], artifactDigest: parseDigestV2(PROTOCOL_SCHEMA_ARTIFACTS_V2[0].artifactDigest) }),
      Object.freeze({ ...PROTOCOL_SCHEMA_ARTIFACTS_V2[1], artifactDigest: parseDigestV2(PROTOCOL_SCHEMA_ARTIFACTS_V2[1].artifactDigest) }),
      Object.freeze({ ...PROTOCOL_SCHEMA_ARTIFACTS_V2[2], artifactDigest: parseDigestV2(PROTOCOL_SCHEMA_ARTIFACTS_V2[2].artifactDigest) }),
      Object.freeze({ ...PROTOCOL_SCHEMA_ARTIFACTS_V2[3], artifactDigest: parseDigestV2(PROTOCOL_SCHEMA_ARTIFACTS_V2[3].artifactDigest) }),
    ] as const),
    channelContractDigest: requirePinnedDigest(
      value.channelContractDigest,
      PINNED_AUTHORITY_IDENTITIES_V2.channelContractDigest,
      "channel contract digest",
    ),
    domainRegistry: Object.freeze(domainRegistry),
    format: value.format,
    limitsDigest: requirePinnedDigest(
      value.limitsDigest,
      PINNED_AUTHORITY_IDENTITIES_V2.limitsDigest,
      "limits digest",
    ),
    protocolMajor: value.protocolMajor,
    typeNamespaces: PROTOCOL_TYPE_NAMESPACES_V2,
    uriProtocolDigest: requirePinnedDigest(
      value.uriProtocolDigest,
      PINNED_AUTHORITY_IDENTITIES_V2.uriProtocolDigest,
      "URI protocol digest",
    ),
    yjsWireCodec,
  })
}

function requireLiteral<T extends string>(value: unknown, expected: T, label: string): T {
  if (value !== expected) unavailable(`${label} differs from R5`)
  return expected
}

function requirePinnedDigest(value: unknown, expected: string, label: string): DigestV2 {
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/u.test(value)) unavailable(`${label} is not a digest`)
  requireEqual(value, expected, label)
  return value as DigestV2
}

function requireEqual(actual: unknown, expected: string, label: string): void {
  if (actual !== expected) unavailable(`${label} differs from R5`)
}

function unavailable(message: string, options?: ErrorOptions): never {
  throw new ProtocolAuthorityErrorV2("protocol-schema-bundle-unavailable", message, options)
}
