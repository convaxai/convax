import { CanvasTextResourceConflictError } from "@convax/canvas/application/errors"
import {
  parseCanvasCertifiedProjectionPatch,
  parseCanvasRendererResourceHierarchyDelta,
} from "@convax/canvas/collaboration"
import type { CanvasResourceRuntimeState } from "@convax/canvas/core"
import { encodeRestrictedJcs } from "@convax/collaboration"
import {
  canvasResourceHydrationMaximumTargetCount,
  canvasResourceHydrationMaximumTargetIdLength,
  canvasResourceHydrateStaleIpcChannel,
  canvasResourceIpcChannel,
  canvasResourceLocalFileRegisterIpcChannel,
  canvasResourceReadConnectedImageIpcChannel,
  canvasResourceRelinkIpcChannel,
  canvasResourceSaveEditableCopyIpcChannel,
  canvasTextResourceIpcChannel,
  type CanvasResourceAddResult,
  type CanvasResourceAddInput,
  type CanvasResourceClient,
  type CanvasResourceHydrateStaleInput,
  type CanvasResourceHydrationTarget,
  type CanvasResourceRuntimePatch,
  type CanvasTextResourceClient,
} from "../desktop-protocol"
import {
  isCanvasResourcePartialFailureResponse,
  isCanvasTextResourceConflictResponse,
} from "../canvas-resource-private-contract"
import {
  assertEntityRefDto,
  assertOperationReceiptDto,
  requireDigestDto,
  requireId128Dto,
} from "./canvas-operation-receipt-codec"

interface CanvasResourcePreloadClientOptions {
  getPathForFile(file: File): string
  invoke(channel: string, input: unknown): Promise<unknown>
  now?: () => number
  randomUUID?: () => string
}

interface CanvasTextResourcePreloadClientOptions {
  invoke(channel: string, input: unknown): Promise<unknown>
}

interface LocalFileToken {
  expiresAt: number
  path: string
}

export function createCanvasTextResourcePreloadClient(
  options: CanvasTextResourcePreloadClientOptions,
): CanvasTextResourceClient {
  return {
    async save(input, signal) {
      if (signal.aborted) throw signal.reason ?? new DOMException("Aborted", "AbortError")
      let result: unknown
      try {
        result = await options.invoke(canvasTextResourceIpcChannel, {
          canvasId: input.canvasId,
          content: input.content,
          contentRevision: input.contentRevision,
          nodeId: input.nodeId,
          projectId: input.projectId,
          sessionId: input.sessionId,
        })
      } catch {
        throw new Error("Could not save the Canvas text resource")
      }
      if (isCanvasTextResourceConflictResponse(result)) {
        throw new CanvasTextResourceConflictError(input.contentRevision, result.actualRevision)
      }
      if (!isRecord(result) || !isSha256(result.contentRevision)) {
        throw new Error("Canvas text resource response is invalid")
      }
      return { contentRevision: result.contentRevision }
    },
  }
}

const localFileTokenLifetimeMs = 60_000
const maximumLocalFileTokens = 1_000

export function createCanvasResourcePreloadClient(options: CanvasResourcePreloadClientOptions): CanvasResourceClient {
  const now = options.now ?? Date.now
  const randomUUID = options.randomUUID ?? (() => globalThis.crypto.randomUUID())
  const tokens = new Map<string, LocalFileToken>()

  const pruneExpired = (currentTime = now()) => {
    for (const [token, value] of tokens) {
      if (value.expiresAt < currentTime) tokens.delete(token)
    }
  }

  const makeRoomForToken = () => {
    while (tokens.size >= maximumLocalFileTokens) {
      const oldest = tokens.keys().next().value
      if (!oldest) break
      tokens.delete(oldest)
    }
  }

  return {
    async add(input) {
      const sessionId = requireId128Dto(input.sessionId, "Canvas session id")
      const localFiles = Array.isArray(input.localFiles) ? input.localFiles : []
      const sources = Array.isArray(input.sources) ? input.sources : []
      if (input.anchorOrigin !== undefined && input.anchorOrigin !== "center" && input.anchorOrigin !== "top-left") {
        throw new Error("Canvas resource anchor origin is invalid")
      }
      if (localFiles.length === 0 && sources.length === 0 && input.pending === undefined) {
        throw new Error("At least one Canvas resource source is required")
      }
      if (
        input.pending !== undefined &&
        (localFiles.length > 0 ||
          sources.length > 0 ||
          (input.pending.kind !== "image" && input.pending.kind !== "video") ||
          typeof input.pending.label !== "string" ||
          !input.pending.label)
      ) {
        throw new Error("Pending Canvas resource request is invalid")
      }

      const sourceIds = new Set<string>()
      for (const source of sources) addUniqueSourceId(sourceIds, source?.sourceId)
      const sourceTokens = new Set<string>()
      for (const file of localFiles) {
        addUniqueSourceId(sourceIds, file?.sourceId)
        if (typeof file?.sourceToken !== "string" || !file.sourceToken) {
          throw new Error("Local file authorization is required")
        }
        if (sourceTokens.has(file.sourceToken)) throw new Error("Local file authorization is duplicated")
        sourceTokens.add(file.sourceToken)
      }

      const currentTime = now()
      pruneExpired(currentTime)
      const resolved = localFiles.map((file) => {
        const token = tokens.get(file.sourceToken)
        if (!token || token.expiresAt < currentTime) {
          throw new Error("Local file authorization has expired or is invalid")
        }
        return {
          ...(file.mediaType === undefined ? {} : { mediaType: file.mediaType }),
          name: file.name,
          sourceId: file.sourceId,
          sourcePath: token.path,
        }
      })

      for (const token of sourceTokens) tokens.delete(token)
      let result: unknown
      try {
        result = await options.invoke(canvasResourceIpcChannel, {
          anchor: input.anchor,
          ...(input.anchorOrigin === undefined ? {} : { anchorOrigin: input.anchorOrigin }),
          canvasId: input.canvasId,
          commandId: input.commandId,
          externalFiles: resolved,
          ...(input.parentId === undefined ? {} : { parentId: input.parentId }),
          ...(input.pending === undefined ? {} : { pending: input.pending }),
          projectId: input.projectId,
          sessionId,
          ...(input.relation === undefined ? {} : { relation: input.relation }),
          sources,
        })
      } catch {
        throw new Error("Could not add the selected resources to the Canvas")
      }
      if (isCanvasResourcePartialFailureResponse(result)) {
        throw new Error(
          `Could not add the selected resources to the Canvas; these Notes files were retained: ${result.retainedLabels.join(
            ", ",
          )}`,
        )
      }
      return requireCanvasResourceAddResult(result, input)
    },
    createLocalFileToken(file) {
      const filePath = options.getPathForFile(file)
      if (!filePath) return ""
      pruneExpired()
      makeRoomForToken()
      const token = `canvas-resource_${randomUUID()}`
      tokens.set(token, { expiresAt: now() + localFileTokenLifetimeMs, path: filePath })
      return token
    },
    async hydrateStale(input) {
      const request = requireCanvasResourceHydrateStaleInput(input)
      let result: unknown
      try {
        result = await options.invoke(canvasResourceHydrateStaleIpcChannel, request)
      } catch {
        throw new Error("Could not refresh Canvas resources")
      }
      return Object.freeze({ patches: requireCanvasResourceRuntimePatches(result, request.targets) })
    },
    async relink(input) {
      let source: Parameters<CanvasResourceClient["relink"]>[0]["source"]
      if (input.source.kind === "host-file" || input.source.kind === "host-directory") {
        source = { kind: input.source.kind, path: input.source.path }
      } else if (input.source.kind === "local-file") {
        const currentTime = now()
        pruneExpired(currentTime)
        const token = tokens.get(input.source.sourceToken)
        if (!token || token.expiresAt < currentTime) {
          throw new Error("Local file authorization has expired or is invalid")
        }
        tokens.delete(input.source.sourceToken)
        try {
          await options.invoke(canvasResourceLocalFileRegisterIpcChannel, {
            sourcePath: token.path,
            sourceToken: input.source.sourceToken,
          })
        } catch {
          throw new Error("Could not authorize the selected local file")
        }
        source = {
          kind: "local-file",
          ...(input.source.mediaType === undefined ? {} : { mediaType: input.source.mediaType }),
          name: input.source.name,
          sourceToken: input.source.sourceToken,
        }
      } else {
        throw new Error("Canvas relink source is invalid")
      }
      return invokeCanvasResourceRelink(
        options,
        canvasResourceRelinkIpcChannel,
        {
          canvasId: input.canvasId,
          commandId: input.commandId,
          nodeId: input.nodeId,
          projectId: input.projectId,
          sessionId: input.sessionId,
          source,
        },
        input,
      )
    },
    async readConnectedImage(input) {
      let result: unknown
      try {
        result = await options.invoke(canvasResourceReadConnectedImageIpcChannel, input)
      } catch {
        throw new Error("Could not read the connected Canvas image")
      }
      return requireConnectedImageReadResult(result)
    },
    saveEditableCopy(input) {
      return invokeCanvasResourceRelink(
        options,
        canvasResourceSaveEditableCopyIpcChannel,
        {
          canvasId: input.canvasId,
          commandId: input.commandId,
          nodeId: input.nodeId,
          projectId: input.projectId,
          sessionId: input.sessionId,
        },
        input,
      )
    },
  }
}

const connectedImageMimeTypes = new Set(["image/jpeg", "image/png", "image/webp"])
const maximumConnectedImageBytes = 16 * 1024 * 1024

function requireConnectedImageReadResult(value: unknown) {
  if (!isRecord(value)) throw new Error("Connected Canvas image response is invalid")
  const keys = Object.keys(value)
  if (
    keys.length !== 4 ||
    keys.some((key) => key !== "dataUrl" && key !== "mimeType" && key !== "name" && key !== "size")
  ) {
    throw new Error("Connected Canvas image response is invalid")
  }
  if (typeof value.mimeType !== "string" || !connectedImageMimeTypes.has(value.mimeType)) {
    throw new Error("Connected Canvas image response is invalid")
  }
  if (typeof value.name !== "string" || !value.name || value.name.length > 255) {
    throw new Error("Connected Canvas image response is invalid")
  }
  if (
    !Number.isSafeInteger(value.size) ||
    (value.size as number) < 0 ||
    (value.size as number) > maximumConnectedImageBytes
  ) {
    throw new Error("Connected Canvas image response is invalid")
  }
  if (typeof value.dataUrl !== "string") throw new Error("Connected Canvas image response is invalid")
  const prefix = `data:${value.mimeType};base64,`
  if (value.dataUrl.slice(0, prefix.length).toLowerCase() !== prefix) {
    throw new Error("Connected Canvas image response is invalid")
  }
  const encoded = value.dataUrl.slice(prefix.length)
  if (encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) {
    throw new Error("Connected Canvas image response is invalid")
  }
  const padding = encoded.endsWith("==") ? 2 : encoded.endsWith("=") ? 1 : 0
  if ((encoded.length / 4) * 3 - padding !== value.size) {
    throw new Error("Connected Canvas image response is invalid")
  }
  return {
    dataUrl: value.dataUrl,
    mimeType: value.mimeType as "image/jpeg" | "image/png" | "image/webp",
    name: value.name,
    size: value.size as number,
  }
}

async function invokeCanvasResourceRelink(
  options: CanvasResourcePreloadClientOptions,
  channel: string,
  input: unknown,
  expected: Pick<CanvasResourceAddInput, "canvasId" | "projectId" | "sessionId">,
) {
  let result: unknown
  try {
    result = await options.invoke(channel, input)
  } catch {
    throw new Error("Could not relink the Canvas resource")
  }
  if (isCanvasResourcePartialFailureResponse(result)) {
    throw new Error(
      `Could not relink the Canvas resource; these Notes files were retained: ${result.retainedLabels.join(", ")}`,
    )
  }
  if (
    !isRecord(result) ||
    Object.keys(result).length !== 3 ||
    !["delivery", "operationReceipt", "warnings"].every((key) => key in result) ||
    !isStringArray(result.warnings)
  ) {
    throw new Error("Canvas relink response is invalid")
  }
  assertOperationReceiptDto(result.operationReceipt)
  return {
    delivery: requireCanvasResourceProjectionDelivery(result.delivery, expected, result.operationReceipt),
    operationReceipt: structuredClone(result.operationReceipt),
    warnings: result.warnings,
  }
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item: unknown) => typeof item === "string")
}

function addUniqueSourceId(sourceIds: Set<string>, value: unknown) {
  if (typeof value !== "string" || !value.trim()) throw new Error("Canvas resource source id is required")
  if (sourceIds.has(value)) throw new Error(`Canvas resource source id is duplicated: ${value}`)
  sourceIds.add(value)
}

function requireCanvasResourceAddResult(
  value: unknown,
  expected: Pick<CanvasResourceAddInput, "canvasId" | "projectId" | "sessionId">,
): CanvasResourceAddResult {
  const record = exactDataRecord(
    value,
    ["createdNodeIds", "delivery", "operationReceipt", "warnings"],
    "Canvas resource response",
  )
  if (
    !isDenseDataArray(record.createdNodeIds) ||
    !isDenseDataArray(record.warnings) ||
    record.createdNodeIds.some((id) => typeof id !== "string") ||
    record.warnings.some((item) => typeof item !== "string")
  ) {
    throw new Error("Canvas resource response is invalid")
  }
  assertOperationReceiptDto(record.operationReceipt)
  const delivery = requireCanvasResourceProjectionDelivery(record.delivery, expected, record.operationReceipt)
  const createdNodeIds = new Set(record.createdNodeIds)
  if (createdNodeIds.size !== record.createdNodeIds.length) {
    throw new Error("Canvas resource response contains duplicate created nodes")
  }
  if (
    delivery.status === "certified" &&
    (delivery.patch.nodes.length !== createdNodeIds.size ||
      delivery.patch.nodes.some((node) => !createdNodeIds.has(node.ref.id)))
  ) {
    throw new Error("Canvas resource response disagrees with its certified projection patch")
  }
  return Object.freeze({
    createdNodeIds: Object.freeze([...record.createdNodeIds]) as readonly string[],
    delivery,
    operationReceipt: structuredClone(record.operationReceipt),
    warnings: Object.freeze([...record.warnings]) as readonly string[],
  })
}

function requireCanvasResourceHydrateStaleInput(value: unknown) {
  const record = exactDataRecord(
    value,
    ["ref", "sessionId", "targets"],
    "Canvas resource refresh request",
  )
  const refRecord = exactDataRecord(record.ref, ["canvasId", "scopeId"], "Canvas resource refresh reference")
  const ref = Object.freeze({
    canvasId: requireBoundedIdentifier(refRecord.canvasId, "Canvas resource refresh canvas id"),
    scopeId: requireBoundedIdentifier(refRecord.scopeId, "Canvas resource refresh scope id"),
  })
  const sessionId = requireId128Dto(record.sessionId, "Canvas resource refresh session id")
  if (
    !isDenseDataArray(record.targets) ||
    record.targets.length < 1 ||
    record.targets.length > canvasResourceHydrationMaximumTargetCount
  ) {
    throw new Error("Canvas resource refresh targets are invalid")
  }
  const nodeIds = new Set<string>()
  const targets = record.targets.map((value): CanvasResourceHydrationTarget => {
    const target = exactDataRecord(value, ["entity", "nodeId"], "Canvas resource refresh target")
    const nodeId = requireBoundedIdentifier(target.nodeId, "Canvas resource refresh node id")
    if (nodeId.length > canvasResourceHydrationMaximumTargetIdLength) {
      throw new Error("Canvas resource refresh target is invalid")
    }
    assertEntityRefDto(target.entity, "node")
    if (target.entity.id !== nodeId || nodeIds.has(nodeId)) {
      throw new Error("Canvas resource refresh target is invalid")
    }
    nodeIds.add(nodeId)
    const entity = target.entity as CanvasResourceHydrationTarget["entity"]
    return Object.freeze({ entity: Object.freeze(structuredClone(entity)), nodeId })
  })
  return Object.freeze({ ref, sessionId, targets: Object.freeze(targets) })
}

function requireCanvasResourceRuntimePatches(
  value: unknown,
  targets: readonly CanvasResourceHydrationTarget[],
): readonly CanvasResourceRuntimePatch[] {
  const record = exactDataRecord(value, ["patches"], "Canvas resource refresh response")
  const expectedNodeIds = new Set(targets.map((target) => target.nodeId))
  const patches = requireRuntimePatches(record.patches, expectedNodeIds, true, "Canvas resource refresh")
  return Object.freeze(patches)
}

function requireRuntimePatches(
  value: unknown,
  allowedNodeIds: ReadonlySet<string>,
  requireComplete: boolean,
  label: string,
): CanvasResourceRuntimePatch[] {
  if (!isDenseDataArray(value) || value.length > 4_096) throw new Error(`${label} patches are invalid`)
  const seen = new Set<string>()
  const patches = value.map((value): CanvasResourceRuntimePatch => {
    const patch = exactDataRecord(value, ["nodeId", "state"], `${label} patch`)
    const nodeId = requireBoundedIdentifier(patch.nodeId, `${label} node id`)
    if (!allowedNodeIds.has(nodeId) || seen.has(nodeId)) throw new Error(`${label} patch target is invalid`)
    seen.add(nodeId)
    return Object.freeze({ nodeId, state: requireCanvasResourceRuntimeState(patch.state, label) })
  })
  if (requireComplete && seen.size !== allowedNodeIds.size) throw new Error(`${label} patches are incomplete`)
  return patches
}

const canvasResourceRuntimeStatuses = new Set([
  "stale",
  "ready",
  "missing",
  "corrupt",
  "unsupported",
  "conflict",
])
const canvasResourceRuntimeKeys = new Set([
  "canSaveEditableCopy",
  "contentRevision",
  "editableText",
  "error",
  "mediaType",
  "name",
  "posterUrl",
  "status",
  "text",
  "url",
])

function requireCanvasResourceRuntimeState(value: unknown, label: string): CanvasResourceRuntimeState {
  const record = requirePlainDataRecord(value, `${label} state`)
  const keys = Object.keys(record)
  if (
    !Object.hasOwn(record, "status") ||
    keys.some((key) => !canvasResourceRuntimeKeys.has(key)) ||
    typeof record.status !== "string" ||
    !canvasResourceRuntimeStatuses.has(record.status)
  ) {
    throw new Error(`${label} state is invalid`)
  }
  for (const key of ["canSaveEditableCopy", "editableText"] as const) {
    if (record[key] !== undefined && typeof record[key] !== "boolean") throw new Error(`${label} state is invalid`)
  }
  for (const key of ["contentRevision", "error", "mediaType", "name", "posterUrl", "text", "url"] as const) {
    if (record[key] !== undefined && typeof record[key] !== "string") throw new Error(`${label} state is invalid`)
  }
  if (record.contentRevision !== undefined && !isSha256(record.contentRevision)) {
    throw new Error(`${label} state is invalid`)
  }
  if (
    exceedsUtf8Bytes(record.error, 4_096) ||
    exceedsUtf8Bytes(record.mediaType, 255) ||
    exceedsUtf8Bytes(record.name, 4_096) ||
    exceedsUtf8Bytes(record.posterUrl, 16_384) ||
    exceedsUtf8Bytes(record.text, 16 * 1024 * 1024) ||
    exceedsUtf8Bytes(record.url, 16_384)
  ) {
    throw new Error(`${label} state is invalid`)
  }
  return Object.freeze(structuredClone(record)) as unknown as CanvasResourceRuntimeState
}

function exceedsUtf8Bytes(value: unknown, maximum: number): boolean {
  return typeof value === "string" && new TextEncoder().encode(value).byteLength > maximum
}

function requireBoundedIdentifier(value: unknown, label: string): string {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.includes("\0") ||
    new TextEncoder().encode(value).byteLength > 1_024
  ) {
    throw new Error(`${label} is invalid`)
  }
  return value
}

function exactDataRecord(value: unknown, keys: readonly string[], label: string): Record<string, unknown> {
  const record = requirePlainDataRecord(value, label)
  const actualKeys = Reflect.ownKeys(record)
  const expectedKeys = [...keys].sort()
  if (
    actualKeys.length !== expectedKeys.length ||
    actualKeys.map(String).sort().some((key, index) => key !== expectedKeys[index])
  ) {
    throw new Error(`${label} field set is invalid`)
  }
  return record
}

function requirePlainDataRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} is invalid`)
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) throw new Error(`${label} is invalid`)
  const record = value as Record<string, unknown>
  const actualKeys = Reflect.ownKeys(record)
  if (actualKeys.some((key) => typeof key !== "string")) throw new Error(`${label} is invalid`)
  for (const key of actualKeys as string[]) {
    const descriptor = Object.getOwnPropertyDescriptor(record, key)
    if (!descriptor?.enumerable || !("value" in descriptor)) throw new Error(`${label} is invalid`)
  }
  return record
}

function isDenseDataArray(value: unknown): value is unknown[] {
  if (!Array.isArray(value)) return false
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index))
    if (!descriptor?.enumerable || !("value" in descriptor)) return false
  }
  const allowedKeys = new Set(["length", ...value.map((_, index) => String(index))])
  return Reflect.ownKeys(value).every((key) => typeof key === "string" && allowedKeys.has(key))
}

function requireCanvasResourceProjectionDelivery(
  value: unknown,
  expected: Pick<CanvasResourceAddInput, "canvasId" | "projectId" | "sessionId">,
  operationReceipt: unknown,
) {
  const discriminator = requirePlainDataRecord(value, "Canvas resource projection delivery")
  if (discriminator.status !== "certified" && discriminator.status !== "unavailable") {
    throw new Error("Canvas resource projection delivery is invalid")
  }
  if (discriminator.status === "unavailable") {
    exactDataRecord(discriminator, ["status"], "Canvas resource projection delivery")
    return Object.freeze({ status: "unavailable" as const })
  }
  const record = exactDataRecord(
    value,
    [
      "acceptedFrameDigest",
      "canRedo",
      "canUndo",
      "format",
      "patch",
      "ref",
      "resourceHierarchy",
      "runtimePatches",
      "sessionId",
      "status",
    ],
    "Canvas resource projection delivery",
  )
  if (record.format !== "convax.canvas-resource-certified-projection-delivery" || record.status !== "certified") {
    throw new Error("Canvas resource projection delivery is invalid")
  }
  const ref = exactDataRecord(record.ref, ["canvasId", "scopeId"], "Canvas resource projection reference")
  if (ref.canvasId !== expected.canvasId || ref.scopeId !== expected.projectId) {
    throw new Error("Canvas resource projection delivery crossed document scope")
  }
  const sessionId = requireId128Dto(record.sessionId, "Canvas resource projection session id")
  if (sessionId !== expected.sessionId) throw new Error("Canvas resource projection delivery is stale")
  if (typeof record.canUndo !== "boolean" || typeof record.canRedo !== "boolean") {
    throw new Error("Canvas resource projection history is invalid")
  }
  const patch = parseCanvasCertifiedProjectionPatch(record.patch)
  if (patch.canvasId !== expected.canvasId || !sameCanonicalValue(patch.receipt, operationReceipt)) {
    throw new Error("Canvas resource projection patch is outside its accepted operation")
  }
  const resourceHierarchy = parseCanvasRendererResourceHierarchyDelta(record.resourceHierarchy)
  if (
    resourceHierarchy.projectionIdentity.canvasId !== patch.canvasId ||
    resourceHierarchy.projectionIdentity.ownerSchemaDigest !== patch.ownerSchemaDigest ||
    resourceHierarchy.projectionIdentity.stateCommitmentDigest !== patch.resultStateCommitmentDigest
  ) {
    throw new Error("Canvas resource hierarchy delta crossed owner projection identity")
  }
  const runtimePatches = Object.freeze(
    requireRuntimePatches(
      record.runtimePatches,
      new Set(patch.nodes.map((node) => node.ref.id)),
      Array.isArray(record.runtimePatches) && record.runtimePatches.length > 0,
      "Canvas prepared resource runtime",
    ),
  )
  return Object.freeze({
    format: "convax.canvas-resource-certified-projection-delivery" as const,
    status: "certified" as const,
    ref: Object.freeze({ canvasId: expected.canvasId, scopeId: expected.projectId }),
    sessionId,
    acceptedFrameDigest: requireDigestDto(record.acceptedFrameDigest, "Canvas accepted frame digest"),
    canUndo: record.canUndo,
    canRedo: record.canRedo,
    patch,
    resourceHierarchy,
    runtimePatches,
  })
}

function sameCanonicalValue(left: unknown, right: unknown): boolean {
  const leftBytes = encodeRestrictedJcs(left)
  const rightBytes = encodeRestrictedJcs(right)
  return leftBytes.byteLength === rightBytes.byteLength && leftBytes.every((byte, index) => byte === rightBytes[index])
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value)
}
