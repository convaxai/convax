import {
  encodeBase64url,
  encodeRestrictedJcs,
  ordinarySha256,
  parseId128,
  type Id128,
} from "@convax/collaboration"

const canvasCommandOperationIdDomain = new TextEncoder().encode("convax.canvas-command-operation-id\0")
const maximumCanvasCommandIdentityBytes = 256

/**
 * Derives the protocol operation identity from host-bound authority and a
 * caller-stable correlation id. The caller never selects an Id128 directly.
 */
export function deriveCanvasCommandOperationId(input: {
  readonly ref: Readonly<{ readonly canvasId: string; readonly scopeId: string }>
  readonly actor: Readonly<{ readonly kind: string; readonly id: string }>
  readonly commandId: string
}): Id128 {
  const canonical = {
    actor: {
      id: requireIdentityComponent(input.actor.id, "Canvas command actor id"),
      kind: requireIdentityComponent(input.actor.kind, "Canvas command actor kind"),
    },
    commandId: requireIdentityComponent(input.commandId, "Canvas command id"),
    ref: {
      canvasId: requireIdentityComponent(input.ref.canvasId, "Canvas id"),
      scopeId: requireIdentityComponent(input.ref.scopeId, "Canvas scope id"),
    },
  }
  const encoded = encodeRestrictedJcs(canonical)
  const preimage = new Uint8Array(canvasCommandOperationIdDomain.byteLength + encoded.byteLength)
  preimage.set(canvasCommandOperationIdDomain)
  preimage.set(encoded, canvasCommandOperationIdDomain.byteLength)
  const digest = ordinarySha256(preimage)
  const first128Bits = new Uint8Array(16)
  for (let index = 0; index < first128Bits.byteLength; index += 1) {
    first128Bits[index] = Number.parseInt(digest.slice(index * 2, index * 2 + 2), 16)
  }
  return parseId128(encodeBase64url(first128Bits))
}

function requireIdentityComponent(value: string, label: string): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.trim().length === 0 ||
    value.normalize("NFC") !== value ||
    new TextEncoder().encode(value).byteLength > maximumCanvasCommandIdentityBytes
  ) {
    throw new TypeError(`${label} is invalid`)
  }
  return value
}
