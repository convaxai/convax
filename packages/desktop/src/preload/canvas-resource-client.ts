import { canvasResourceIpcChannel, type CanvasResourceAddResult, type CanvasResourceClient } from "../desktop-protocol"
import { isCanvasResourcePartialFailureResponse } from "../canvas-resource-private-contract"

interface CanvasResourcePreloadClientOptions {
  getPathForFile(file: File): string
  invoke(channel: string, input: unknown): Promise<unknown>
  now?: () => number
  randomUUID?: () => string
}

interface LocalFileToken {
  expiresAt: number
  path: string
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
      const localFiles = Array.isArray(input.localFiles) ? input.localFiles : []
      const sources = Array.isArray(input.sources) ? input.sources : []
      if (localFiles.length === 0 && sources.length === 0) {
        throw new Error("At least one Canvas resource source is required")
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
          canvasId: input.canvasId,
          commandId: input.commandId,
          expectedRevision: input.expectedRevision,
          externalFiles: resolved,
          projectId: input.projectId,
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
      return requireCanvasResourceAddResult(result)
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
  }
}

function addUniqueSourceId(sourceIds: Set<string>, value: unknown) {
  if (typeof value !== "string" || !value.trim()) throw new Error("Canvas resource source id is required")
  if (sourceIds.has(value)) throw new Error(`Canvas resource source id is duplicated: ${value}`)
  sourceIds.add(value)
}

function requireCanvasResourceAddResult(value: unknown): CanvasResourceAddResult {
  if (!isRecord(value) || !Array.isArray(value.createdNodeIds) || !Array.isArray(value.warnings)) {
    throw new Error("Canvas resource response is invalid")
  }
  const revision = value.revision
  if (typeof revision !== "number" || !Number.isSafeInteger(revision) || revision < 0) {
    throw new Error("Canvas resource response revision is invalid")
  }
  if (
    value.createdNodeIds.some((id) => typeof id !== "string") ||
    value.warnings.some((item) => typeof item !== "string")
  ) {
    throw new Error("Canvas resource response is invalid")
  }
  return {
    createdNodeIds: value.createdNodeIds,
    revision,
    warnings: value.warnings,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}
