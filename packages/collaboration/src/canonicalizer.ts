import { cloneBytesV2 } from "./binary"
import { parseDigestV2 } from "./codecs"
import type { DigestV2 } from "./codecs"
import { KERNEL_DIGEST_DOMAINS_V2, PROTOCOL_SCHEMA_ARTIFACTS_V2 } from "./constants"
import type { DocumentOwnerProtocolPortV2, OwnerCanonicalizerDescriptorV2 } from "./contracts"
import { structuredDigestV2 } from "./digest"
import { failCodec } from "./errors"
import { assertExactKeysV2, assertNfcScalarStringV2, decodeRestrictedJcsV2, encodeRestrictedJcsV2, isPlainDataObject, utf8ByteLengthV2 } from "./jcs"

const CANONICAL_STATE_FORMAT = /^convax\.[a-z0-9][a-z0-9.-]*\/2$/u

export function parseOwnerCanonicalizerDescriptorV2(value: unknown): OwnerCanonicalizerDescriptorV2 {
  const normalized = decodeRestrictedJcsV2(encodeRestrictedJcsV2(value))
  assertExactKeysV2(normalized, [
    "format",
    "owner",
    "ownerSchemaDigest",
    "canonicalStateFormat",
    "canonicalStateCodec",
    "exactBytePolicy",
    "unknownStatePolicy",
  ], "OwnerCanonicalizerDescriptorV2")
  if (normalized.format !== "convax.owner-canonicalizer-descriptor/2") failCodec("Owner canonicalizer descriptor format is invalid")
  if (normalized.owner !== "canvas" && normalized.owner !== "project-index") failCodec("Owner canonicalizer descriptor owner is invalid")
  assertNfcScalarStringV2(normalized.canonicalStateFormat, "Owner canonical state format")
  if (utf8ByteLengthV2(normalized.canonicalStateFormat) < 1 || utf8ByteLengthV2(normalized.canonicalStateFormat) > 128 || !CANONICAL_STATE_FORMAT.test(normalized.canonicalStateFormat)) {
    failCodec("Owner canonical state format is invalid")
  }
  if (normalized.canonicalStateCodec !== "restricted-jcs-utf8" || normalized.exactBytePolicy !== "parse-reencode-byte-equal" || normalized.unknownStatePolicy !== "reject") {
    failCodec("Owner canonicalizer descriptor policy is invalid")
  }
  return Object.freeze({
    format: normalized.format,
    owner: normalized.owner,
    ownerSchemaDigest: parseDigestV2(normalized.ownerSchemaDigest),
    canonicalStateFormat: normalized.canonicalStateFormat,
    canonicalStateCodec: normalized.canonicalStateCodec,
    exactBytePolicy: normalized.exactBytePolicy,
    unknownStatePolicy: normalized.unknownStatePolicy,
  })
}

export function ownerCanonicalizerDescriptorDigestV2(value: OwnerCanonicalizerDescriptorV2 | unknown): DigestV2 {
  return structuredDigestV2(KERNEL_DIGEST_DOMAINS_V2.ownerCanonicalizerDescriptor, parseOwnerCanonicalizerDescriptorV2(value))
}

export function assertDocumentOwnerBindingV2(owner: DocumentOwnerProtocolPortV2): OwnerCanonicalizerDescriptorV2 {
  const descriptor = parseOwnerCanonicalizerDescriptorV2(owner.canonicalizerDescriptor)
  const schemaDigest = parseDigestV2(owner.schemaDigest)
  if (descriptor.owner !== owner.owner || descriptor.ownerSchemaDigest !== schemaDigest) failCodec("Owner canonicalizer descriptor binding mismatches its port")
  if (ownerCanonicalizerDescriptorDigestV2(descriptor) !== parseDigestV2(owner.canonicalizerDigest)) failCodec("Owner canonicalizer digest mismatches its exact descriptor")
  const artifact = owner.owner === "canvas" ? PROTOCOL_SCHEMA_ARTIFACTS_V2[0] : PROTOCOL_SCHEMA_ARTIFACTS_V2[3]
  if (artifact.artifactDigest !== schemaDigest) failCodec("Owner schema digest does not select its frozen protocol artifact")
  return descriptor
}

export function validateOwnerCanonicalStateBytesV2(
  descriptor: OwnerCanonicalizerDescriptorV2,
  value: Uint8Array,
): Uint8Array {
  const exactBytes = cloneBytesV2(value, "owner canonical-state bytes")
  const decoded = decodeRestrictedJcsV2(exactBytes)
  if (!isPlainDataObject(decoded) || decoded.format !== descriptor.canonicalStateFormat) {
    failCodec("Owner canonical state has the wrong top-level format")
  }
  return exactBytes
}
