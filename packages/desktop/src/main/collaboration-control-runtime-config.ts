import { parseDigest, parsePublicKey, type Digest } from "@convax/collaboration"
import type { PinnedControlServiceKeyV2 } from "@convax/project/collaboration-protocol"

export interface DesktopCollaborationControlRuntimeConfigV1 {
  readonly format: "convax.desktop-collaboration-control-runtime/1"
  readonly serviceBaseUrl: string
  readonly trustBundleDigest: Digest
  readonly keys: readonly PinnedControlServiceKeyV2[]
}

/**
 * Deployment-owned public trust roots. Absence disables online collaboration;
 * malformed or partial configuration aborts startup instead of changing trust.
 */
export function parseDesktopCollaborationControlRuntimeConfigV1(
  encoded: string | undefined,
): DesktopCollaborationControlRuntimeConfigV1 | null {
  if (encoded === undefined || encoded.trim() === "") return null
  if (encoded.length > 32 * 1024) throw new TypeError("Collaboration control runtime configuration is too large")
  let value: unknown
  try { value = JSON.parse(encoded) } catch { throw new TypeError("Collaboration control runtime configuration is invalid JSON") }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("Collaboration control runtime configuration is invalid")
  const source = value as Record<string, unknown>
  if (Object.keys(source).sort().join("\0") !== ["format", "keys", "serviceBaseUrl", "trustBundleDigest"].join("\0") ||
    source.format !== "convax.desktop-collaboration-control-runtime/1" ||
    typeof source.serviceBaseUrl !== "string" || !Array.isArray(source.keys) || source.keys.length < 1 || source.keys.length > 32) {
    throw new TypeError("Collaboration control runtime configuration has unsupported fields")
  }
  const keys = source.keys.map((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("Collaboration trust key is invalid")
    const key = value as Record<string, unknown>
    if (Object.keys(key).sort().join("\0") !== ["publicKey", "purpose", "serviceKeyId"].join("\0") ||
      (key.purpose !== "membership" && key.purpose !== "rendezvous") ||
      typeof key.serviceKeyId !== "string" || !/^[A-Za-z0-9._-]{1,128}$/u.test(key.serviceKeyId)) {
      throw new TypeError("Collaboration trust key has unsupported fields")
    }
    return Object.freeze({ purpose: key.purpose, serviceKeyId: key.serviceKeyId, publicKey: parsePublicKey(key.publicKey) })
  })
  const selectors = keys.map((key) => `${key.purpose}\0${key.serviceKeyId}`)
  if (new Set(selectors).size !== selectors.length) throw new TypeError("Collaboration trust keys contain a duplicate selector")
  return Object.freeze({
    format: source.format,
    serviceBaseUrl: source.serviceBaseUrl,
    trustBundleDigest: parseDigest(source.trustBundleDigest),
    keys: Object.freeze(keys),
  })
}
