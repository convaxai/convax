import { parseDigest, type Digest } from "./codecs"
import {
  KERNEL_DIGEST_DOMAINS,
  CURRENT_PROTOCOL_IDENTITIES,
  PROTOCOL_SCHEMA_ARTIFACTS,
  PROTOCOL_TYPE_NAMESPACES,
} from "./constants"
import type { ProtocolSchemaBundleCore, ProtocolSchemaBundle } from "./contracts"
import { structuredDigest } from "./digest"
import { ProtocolAuthorityError } from "./errors"
import { assertDenseArray, assertExactKeys, encodeRestrictedJcs, isPlainDataObject, sameBytes } from "./jcs"

const validAuthorities = new WeakSet<object>()

/**
 * Process-local proof that the current protocol implementation is installed. The
 * shape is intentionally insufficient: every consumer also checks the
 * module-private live registry, so a structural clone has no authority.
 */
export interface CurrentProtocolAuthority {
  readonly protocolDigest: Digest
  readonly artifactDigests: readonly Digest[]
  readonly protocolSchemaBundle: ProtocolSchemaBundle
}

/** Called only by the current protocol descriptor after it verifies its own bytes. */
export function installProtocolAuthority(bundleValue: unknown): CurrentProtocolAuthority {
  try {
    const protocolSchemaBundle = parseVerifiedBundle(bundleValue)
    const authority = Object.freeze({
      protocolDigest: protocolSchemaBundle.protocolDigest,
      artifactDigests: Object.freeze(protocolSchemaBundle.core.artifacts.map((artifact) => artifact.artifactDigest)),
      protocolSchemaBundle,
    })
    validAuthorities.add(authority)
    return authority
  } catch (error) {
    if (error instanceof ProtocolAuthorityError) throw error
    unavailable("The current collaboration protocol implementation cannot be installed", { cause: error })
  }
}

export function assertCurrentProtocolAuthority(value: unknown): asserts value is CurrentProtocolAuthority {
  if (typeof value !== "object" || value === null || !validAuthorities.has(value)) {
    unavailable("A live installation of the current collaboration protocol authority is required")
  }
}

function parseVerifiedBundle(value: unknown): ProtocolSchemaBundle {
  assertExactKeys(value, ["core", "coreDigest", "format", "protocolDigest"], "ProtocolSchemaBundle")
  if (value.format !== "convax.protocol-schema-bundle/2") unavailable("ProtocolSchemaBundle format is invalid")
  const core = parseVerifiedBundleCore(value.core)
  const coreDigest = structuredDigest(KERNEL_DIGEST_DOMAINS.protocolSchemaBundleCore, core)
  requireEqual(coreDigest, CURRENT_PROTOCOL_IDENTITIES.protocolDigest, "ProtocolSchemaBundle core digest")
  requireEqual(value.coreDigest, coreDigest, "ProtocolSchemaBundle coreDigest")
  requireEqual(value.protocolDigest, coreDigest, "ProtocolSchemaBundle protocolDigest")
  return Object.freeze({
    core,
    coreDigest,
    format: value.format,
    protocolDigest: coreDigest,
  })
}

function parseVerifiedBundleCore(value: unknown): ProtocolSchemaBundleCore {
  assertExactKeys(
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
    "ProtocolSchemaBundleCore",
  )
  if (value.format !== "convax.protocol-schema-bundle-core/2" || value.protocolMajor !== "2") {
    unavailable("ProtocolSchemaBundle core discriminators are invalid")
  }
  if (!sameBytes(encodeRestrictedJcs(value.artifacts), encodeRestrictedJcs(PROTOCOL_SCHEMA_ARTIFACTS))) {
    unavailable("ProtocolSchemaBundle artifact tuple differs from the current protocol")
  }
  if (!sameBytes(encodeRestrictedJcs(value.typeNamespaces), encodeRestrictedJcs(PROTOCOL_TYPE_NAMESPACES))) {
    unavailable("ProtocolSchemaBundle namespace tuple differs from the current protocol")
  }
  assertDenseArray(value.domainRegistry, "ProtocolSchemaBundle domainRegistry")
  const domainRegistry = value.domainRegistry.map((domain) => {
    if (typeof domain !== "string" || !domain.endsWith("/2")) {
      unavailable("ProtocolSchemaBundle has an invalid digest domain")
    }
    return domain
  })
  if (
    domainRegistry.length !== 127 ||
    domainRegistry.some((domain, index) => index > 0 && domainRegistry[index - 1]! >= domain)
  ) {
    unavailable("ProtocolSchemaBundle domain registry is not the exact sorted current domain set")
  }
  if (!isPlainDataObject(value.yjsWireCodec)) unavailable("ProtocolSchemaBundle Yjs codec is invalid")
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
      Object.freeze({ ...PROTOCOL_SCHEMA_ARTIFACTS[0], artifactDigest: parseDigest(PROTOCOL_SCHEMA_ARTIFACTS[0].artifactDigest) }),
      Object.freeze({ ...PROTOCOL_SCHEMA_ARTIFACTS[1], artifactDigest: parseDigest(PROTOCOL_SCHEMA_ARTIFACTS[1].artifactDigest) }),
      Object.freeze({ ...PROTOCOL_SCHEMA_ARTIFACTS[2], artifactDigest: parseDigest(PROTOCOL_SCHEMA_ARTIFACTS[2].artifactDigest) }),
      Object.freeze({ ...PROTOCOL_SCHEMA_ARTIFACTS[3], artifactDigest: parseDigest(PROTOCOL_SCHEMA_ARTIFACTS[3].artifactDigest) }),
    ] as const),
    channelContractDigest: requirePinnedDigest(
      value.channelContractDigest,
      CURRENT_PROTOCOL_IDENTITIES.channelContractDigest,
      "channel contract digest",
    ),
    domainRegistry: Object.freeze(domainRegistry),
    format: value.format,
    limitsDigest: requirePinnedDigest(
      value.limitsDigest,
      CURRENT_PROTOCOL_IDENTITIES.limitsDigest,
      "limits digest",
    ),
    protocolMajor: value.protocolMajor,
    typeNamespaces: PROTOCOL_TYPE_NAMESPACES,
    uriProtocolDigest: requirePinnedDigest(
      value.uriProtocolDigest,
      CURRENT_PROTOCOL_IDENTITIES.uriProtocolDigest,
      "URI protocol digest",
    ),
    yjsWireCodec,
  })
}

function requireLiteral<T extends string>(value: unknown, expected: T, label: string): T {
  if (value !== expected) unavailable(`${label} differs from the current protocol`)
  return expected
}

function requirePinnedDigest(value: unknown, expected: string, label: string): Digest {
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/u.test(value)) unavailable(`${label} is not a digest`)
  requireEqual(value, expected, label)
  return value as Digest
}

function requireEqual(actual: unknown, expected: string, label: string): void {
  if (actual !== expected) unavailable(`${label} differs from the current protocol`)
}

function unavailable(message: string, options?: ErrorOptions): never {
  throw new ProtocolAuthorityError("protocol-schema-bundle-unavailable", message, options)
}
