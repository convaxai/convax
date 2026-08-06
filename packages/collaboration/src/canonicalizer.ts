import { cloneBytes } from "./binary"
import { parseDigest } from "./codecs"
import type { Digest } from "./codecs"
import { KERNEL_DIGEST_DOMAINS, PROTOCOL_SCHEMA_ARTIFACTS } from "./constants"
import type { DocumentOwnerProtocolPort, OwnerCanonicalizerDescriptor } from "./contracts"
import { structuredDigest } from "./digest"
import { failCodec } from "./errors"
import { assertExactKeys, assertNfcScalarString, decodeRestrictedJcs, encodeRestrictedJcs, isPlainDataObject, utf8ByteLength } from "./jcs"

const CANONICAL_STATE_FORMAT = /^convax\.[a-z0-9][a-z0-9.-]*\/2$/u

export function parseOwnerCanonicalizerDescriptor(value: unknown): OwnerCanonicalizerDescriptor {
  const normalized = decodeRestrictedJcs(encodeRestrictedJcs(value))
  assertExactKeys(normalized, [
    "format",
    "owner",
    "ownerSchemaDigest",
    "canonicalStateFormat",
    "canonicalStateCodec",
    "exactBytePolicy",
    "unknownStatePolicy",
  ], "OwnerCanonicalizerDescriptor")
  if (normalized.format !== "convax.owner-canonicalizer-descriptor/2") failCodec("Owner canonicalizer descriptor format is invalid")
  if (normalized.owner !== "canvas" && normalized.owner !== "project-index") failCodec("Owner canonicalizer descriptor owner is invalid")
  assertNfcScalarString(normalized.canonicalStateFormat, "Owner canonical state format")
  if (utf8ByteLength(normalized.canonicalStateFormat) < 1 || utf8ByteLength(normalized.canonicalStateFormat) > 128 || !CANONICAL_STATE_FORMAT.test(normalized.canonicalStateFormat)) {
    failCodec("Owner canonical state format is invalid")
  }
  if (normalized.canonicalStateCodec !== "restricted-jcs-utf8" || normalized.exactBytePolicy !== "parse-reencode-byte-equal" || normalized.unknownStatePolicy !== "reject") {
    failCodec("Owner canonicalizer descriptor policy is invalid")
  }
  return Object.freeze({
    format: normalized.format,
    owner: normalized.owner,
    ownerSchemaDigest: parseDigest(normalized.ownerSchemaDigest),
    canonicalStateFormat: normalized.canonicalStateFormat,
    canonicalStateCodec: normalized.canonicalStateCodec,
    exactBytePolicy: normalized.exactBytePolicy,
    unknownStatePolicy: normalized.unknownStatePolicy,
  })
}

export function ownerCanonicalizerDescriptorDigest(value: OwnerCanonicalizerDescriptor | unknown): Digest {
  return structuredDigest(KERNEL_DIGEST_DOMAINS.ownerCanonicalizerDescriptor, parseOwnerCanonicalizerDescriptor(value))
}

export function assertDocumentOwnerBinding(owner: DocumentOwnerProtocolPort): OwnerCanonicalizerDescriptor {
  const descriptor = parseOwnerCanonicalizerDescriptor(owner.canonicalizerDescriptor)
  const schemaDigest = parseDigest(owner.schemaDigest)
  if (descriptor.owner !== owner.owner || descriptor.ownerSchemaDigest !== schemaDigest) failCodec("Owner canonicalizer descriptor binding mismatches its port")
  if (ownerCanonicalizerDescriptorDigest(descriptor) !== parseDigest(owner.canonicalizerDigest)) failCodec("Owner canonicalizer digest mismatches its exact descriptor")
  const artifact = owner.owner === "canvas" ? PROTOCOL_SCHEMA_ARTIFACTS[0] : PROTOCOL_SCHEMA_ARTIFACTS[3]
  if (artifact.artifactDigest !== schemaDigest) failCodec("Owner schema digest does not select its frozen protocol artifact")
  return descriptor
}

export function validateOwnerCanonicalStateBytes(
  descriptor: OwnerCanonicalizerDescriptor,
  value: Uint8Array,
): Uint8Array {
  const exactBytes = cloneBytes(value, "owner canonical-state bytes")
  const decoded = decodeRestrictedJcs(exactBytes)
  if (!isPlainDataObject(decoded) || decoded.format !== descriptor.canonicalStateFormat) {
    failCodec("Owner canonical state has the wrong top-level format")
  }
  return exactBytes
}
