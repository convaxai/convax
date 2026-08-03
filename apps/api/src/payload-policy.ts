const forbiddenKeys = new Set([
  "admission",
  "admissionCertificate",
  "actorCounterAbandonment",
  "blobBytes",
  "canvasState",
  "causalFrame",
  "checkpointPayload",
  "docEpoch",
  "editOrder",
  "editSequence",
  "frameBytes",
  "mmr",
  "operationLookup",
  "pluginState",
  "projectFileBytes",
  "projectIndexState",
  "serverEditSequence",
  "snapshotBytes",
  "typedIntent",
  "yjs",
  "yjsUpdate",
])

export type PayloadPolicyFailureV2 =
  | "body-too-large"
  | "invalid-content-type"
  | "invalid-json"
  | "edit-payload-forbidden"

export class PayloadPolicyErrorV2 extends Error {
  constructor(readonly code: PayloadPolicyFailureV2) {
    super(code)
    this.name = "PayloadPolicyErrorV2"
  }
}

export async function readControlMetadataJsonV2(request: Request, maxBytes = 65_536): Promise<unknown> {
  const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase()
  if (contentType !== "application/json") throw new PayloadPolicyErrorV2("invalid-content-type")
  const declaredLength = request.headers.get("content-length")
  if (declaredLength && (!/^(?:0|[1-9][0-9]*)$/u.test(declaredLength) || BigInt(declaredLength) > maxBytes)) {
    throw new PayloadPolicyErrorV2("body-too-large")
  }
  if (!request.body) throw new PayloadPolicyErrorV2("body-too-large")
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let byteLength = 0
  try {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) break
      if (byteLength + chunk.value.byteLength > maxBytes) {
        await reader.cancel("body-too-large")
        throw new PayloadPolicyErrorV2("body-too-large")
      }
      byteLength += chunk.value.byteLength
      chunks.push(chunk.value)
    }
  } finally {
    reader.releaseLock()
  }
  if (byteLength === 0) throw new PayloadPolicyErrorV2("body-too-large")
  const bytes = new Uint8Array(byteLength)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  let value: unknown
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown
  } catch {
    throw new PayloadPolicyErrorV2("invalid-json")
  }
  assertPayloadZeroV2(value)
  return value
}

export function assertPayloadZeroV2(value: unknown): void {
  const stack: unknown[] = [value]
  let visited = 0
  while (stack.length > 0) {
    const current = stack.pop()
    visited += 1
    if (visited > 8_192) throw new PayloadPolicyErrorV2("body-too-large")
    if (Array.isArray(current)) {
      if (current.length > 4_096) throw new PayloadPolicyErrorV2("body-too-large")
      stack.push(...current)
      continue
    }
    if (current === null || typeof current !== "object") continue
    for (const [key, child] of Object.entries(current)) {
      if (forbiddenKeys.has(key)) throw new PayloadPolicyErrorV2("edit-payload-forbidden")
      stack.push(child)
    }
  }
}
