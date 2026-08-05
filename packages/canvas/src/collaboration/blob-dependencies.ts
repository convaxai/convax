import {
  compareBytesV2,
  encodeRestrictedJcsV2,
  parseDigestV2,
  type DecodedCausalEditFrameV2,
  type DecodedCausalEditFrameV3,
  type DigestV2,
} from "@convax/collaboration"

import { decodeCanvasTypedIntentV2 } from "./intent-validation"
import { assertResourceRefV2 } from "./validation"

const MAX_REQUIRED_BLOBS_PER_FRAME = 256

/**
 * Derives the immutable blob closure from one already decoded Canvas frame.
 * Plugin state is opaque and is never scanned as Host resource metadata.
 */
export function requiredCanvasBlobDigestsV2(
  frame: DecodedCausalEditFrameV2 | DecodedCausalEditFrameV3,
): readonly DigestV2[] {
  if (frame.header.core.scope.docKind !== "canvas") {
    throw new TypeError("Canvas blob dependency extraction received another document owner")
  }
  const intent = decodeCanvasTypedIntentV2(new Uint8Array(frame.sections.typedIntentJcs))
  if (frame.header.core.intentKind !== intent.kind) {
    throw new TypeError("Canvas frame intent kind does not match its exact typed intent")
  }
  const canonical = encodeRestrictedJcsV2(intent)
  if (compareBytesV2(canonical, frame.sections.typedIntentJcs) !== 0) {
    throw new TypeError("Canvas typed intent bytes are not canonical restricted JCS")
  }

  const digests = new Set<DigestV2>()
  walkHostValue(intent, (value) => {
    if (value.format !== "convax.canvas-resource-ref/2") return
    assertResourceRefV2(value)
    digests.add(parseDigestV2(value.contentDigest))
  })
  const result = [...digests].sort()
  if (result.length > MAX_REQUIRED_BLOBS_PER_FRAME) {
    throw new TypeError("Canvas frame requires more than 256 immutable blobs")
  }
  return Object.freeze(result)
}

function walkHostValue(value: unknown, visit: (value: Record<string, unknown>) => void): void {
  if (Array.isArray(value)) {
    for (const item of value) walkHostValue(item, visit)
    return
  }
  if (typeof value !== "object" || value === null) return
  const record = value as Record<string, unknown>
  visit(record)
  for (const [key, child] of Object.entries(record)) {
    if (record.format === "convax.canvas-plugin-state/2" && key === "state") continue
    walkHostValue(child, visit)
  }
}
