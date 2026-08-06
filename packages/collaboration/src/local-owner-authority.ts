import { parseActorId, parseDigest, parseReplicaId, type Digest } from "./codecs"
import { CURRENT_PROTOCOL_IDENTITIES, KERNEL_DIGEST_DOMAINS } from "./constants"
import type { LocalOwnerEditAuthorizationCore } from "./contracts"
import { structuredDigest } from "./digest"
import { failCodec } from "./errors"
import { assertExactKeys } from "./jcs"
import { parseDocumentScope } from "./parse"

export function parseLocalOwnerEditAuthorizationCore(
  value: unknown,
): LocalOwnerEditAuthorizationCore {
  assertExactKeys(value, [
    "format", "scope", "replicaId", "actorId", "ownerBindingDigest",
    "protocolDigest", "ownerSchemaDigest", "expiryPolicy",
  ], "LocalOwnerEditAuthorizationCore")
  if (value.format !== "convax.local-owner-edit-authorization-core") {
    failCodec("Local owner edit authorization format is invalid")
  }
  const protocolDigest = parseDigest(value.protocolDigest)
  if (protocolDigest !== CURRENT_PROTOCOL_IDENTITIES.protocolDigest) {
    failCodec("Local owner edit authorization is not for the current protocol")
  }
  if (value.expiryPolicy !== "none") {
    failCodec("Local owner edit authorization expiry policy is invalid")
  }
  return Object.freeze({
    format: value.format,
    scope: parseDocumentScope(value.scope),
    replicaId: parseReplicaId(value.replicaId),
    actorId: parseActorId(value.actorId),
    ownerBindingDigest: parseDigest(value.ownerBindingDigest),
    protocolDigest,
    ownerSchemaDigest: parseDigest(value.ownerSchemaDigest),
    expiryPolicy: value.expiryPolicy,
  })
}

export function localOwnerEditAuthorizationCoreDigest(
  value: LocalOwnerEditAuthorizationCore,
): Digest {
  return structuredDigest(
    KERNEL_DIGEST_DOMAINS.localOwnerEditAuthorizationCore,
    parseLocalOwnerEditAuthorizationCore(value),
  )
}
