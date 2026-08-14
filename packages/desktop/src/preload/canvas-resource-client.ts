import { CanvasTextResourceConflictError } from "@convax/canvas/application/errors"
import { parseCanvasDocument } from "@convax/canvas/core"
import {
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
  type CanvasTextResourceClient,
} from "../desktop-protocol"
import {
  isCanvasResourcePartialFailureResponse,
  isCanvasTextResourceConflictResponse,
} from "../canvas-resource-private-contract"
import { assertOperationReceiptDto, requireDigestDto, requireId128Dto } from "./canvas-operation-receipt-codec"
import { requireCanvasSessionProjection } from "./canvas-session-client"

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
      let result: unknown
      try {
        result = await options.invoke(canvasResourceHydrateStaleIpcChannel, input)
      } catch {
        throw new Error("Could not refresh Canvas resources")
      }
      const document = parseCanvasDocument(result, input.canvasId)
      if (!document) throw new Error("Canvas resource refresh response is invalid")
      return document
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
    delivery: requireCanvasResourceProjectionDelivery(result.delivery, expected),
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
  if (!isRecord(value) || !Array.isArray(value.createdNodeIds) || !Array.isArray(value.warnings)) {
    throw new Error("Canvas resource response is invalid")
  }
  if (
    Object.keys(value).length !== 4 ||
    !["createdNodeIds", "delivery", "operationReceipt", "warnings"].every((key) => key in value)
  ) {
    throw new Error("Canvas resource response has an invalid field set")
  }
  if (
    value.createdNodeIds.some((id) => typeof id !== "string") ||
    value.warnings.some((item) => typeof item !== "string")
  ) {
    throw new Error("Canvas resource response is invalid")
  }
  assertOperationReceiptDto(value.operationReceipt)
  const delivery = requireCanvasResourceProjectionDelivery(value.delivery, expected)
  return {
    createdNodeIds: value.createdNodeIds,
    delivery,
    operationReceipt: structuredClone(value.operationReceipt),
    warnings: value.warnings,
  }
}

function requireCanvasResourceProjectionDelivery(
  value: unknown,
  expected: Pick<CanvasResourceAddInput, "canvasId" | "projectId" | "sessionId">,
) {
  if (!isRecord(value) || (value.status !== "accepted" && value.status !== "unavailable")) {
    throw new Error("Canvas resource projection delivery is invalid")
  }
  if (value.status === "unavailable") {
    if (Object.keys(value).length !== 1) throw new Error("Canvas resource projection delivery is invalid")
    return Object.freeze({ status: "unavailable" as const })
  }
  if (Object.keys(value).length !== 3 || typeof value.projection !== "object" || !value.projection) {
    throw new Error("Canvas resource projection delivery is invalid")
  }
  return Object.freeze({
    status: "accepted" as const,
    acceptedFrameDigest: requireDigestDto(value.acceptedFrameDigest, "Canvas accepted frame digest"),
    projection: requireCanvasSessionProjection(
      value.projection,
      { canvasId: expected.canvasId, scopeId: expected.projectId },
      expected.sessionId,
    ),
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value)
}
