import {
  encodeBase64urlV2,
  encodeRestrictedJcsV2,
  ordinarySha256V2,
  parseId128V2,
  type Id128V2,
} from "@convax/collaboration"

const canvasCommandOperationIdDomain = new TextEncoder().encode("convax.canvas-command-operation-id/2\0")
const maximumCanvasCommandIdentityBytes = 256

/**
 * Derives the protocol operation identity from host-bound authority and a
 * caller-stable correlation id. The caller never selects an Id128 directly.
 */
export function deriveCanvasCommandOperationIdV2(input: {
  readonly ref: Readonly<{ readonly canvasId: string; readonly scopeId: string }>
  readonly actor: Readonly<{ readonly kind: string; readonly id: string }>
  readonly commandId: string
}): Id128V2 {
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
  const encoded = encodeRestrictedJcsV2(canonical)
  const preimage = new Uint8Array(canvasCommandOperationIdDomain.byteLength + encoded.byteLength)
  preimage.set(canvasCommandOperationIdDomain)
  preimage.set(encoded, canvasCommandOperationIdDomain.byteLength)
  const digest = ordinarySha256V2(preimage)
  const first128Bits = new Uint8Array(16)
  for (let index = 0; index < first128Bits.byteLength; index += 1) {
    first128Bits[index] = Number.parseInt(digest.slice(index * 2, index * 2 + 2), 16)
  }
  return parseId128V2(encodeBase64urlV2(first128Bits))
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
