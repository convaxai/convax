import { spawn } from "node:child_process"
import { randomBytes } from "node:crypto"
import { createReadStream } from "node:fs"
import fs from "node:fs/promises"
import { createServer, type Server, type ServerResponse } from "node:http"
import path from "node:path"
import type { Socket } from "node:net"
import { pipeline } from "node:stream/promises"

const jianyingBundleId = "com.lemon.lvpro"
const jianyingDeepLinkBase = "videocut://com.ies.videocut/uganchor/anchor_point/nothing"
const jianyingForceCreateDraftDeepLink =
  "videocut://com.ies.videocut/main/draft/new_draft?force_create=true"
const defaultTransferTimeoutMs = 15_000

export type JianyingDeepLinkTarget = "current"
export type JianyingDeepLinkMediaType = "image" | "video"

export interface JianyingDeepLinkMedia {
  mediaType: JianyingDeepLinkMediaType
  mimeType: string
  name: string
  /** Absolute path to a persistent, already validated staged file. */
  path: string
}

export interface JianyingMaterialTransferItemEvidence {
  bytes: number
  completed: boolean
  mediaType: JianyingDeepLinkMediaType
  mimeType: string
  name: string
  size: number
  successfulTransfers: number
}

export interface JianyingMaterialImportEvidence {
  deepLinkDispatched: boolean
  items: readonly JianyingMaterialTransferItemEvidence[]
  target: JianyingDeepLinkTarget
}

export interface JianyingMaterialImportInput {
  media: readonly JianyingDeepLinkMedia[]
  target: JianyingDeepLinkTarget
}

export type JianyingOpenDeepLink = (url: string, signal?: AbortSignal) => Promise<void>

export type JianyingDeepLinkDispatchErrorCode = "cancelled" | "dispatch_failed" | "timeout" | "transport_failed"

export class JianyingDeepLinkDispatchError extends Error {
  constructor(
    message: string,
    readonly code: JianyingDeepLinkDispatchErrorCode,
    readonly evidence: JianyingMaterialImportEvidence,
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.name = code === "cancelled" ? "AbortError" : "JianyingDeepLinkDispatchError"
  }
}

interface PreparedMedia extends JianyingDeepLinkMedia {
  endpointPath: string
  size: number
}

interface MutableTransferState {
  intervals: Array<readonly [number, number]>
  successfulTransfers: number
}

interface ByteRange {
  end: number
  start: number
}

class TransferTimeoutError extends Error {}

export class MacOSJianyingDeepLinkTransport {
  private readonly openDeepLink: JianyingOpenDeepLink
  private readonly timeoutMs: number

  constructor(options: { openDeepLink?: JianyingOpenDeepLink; timeoutMs?: number } = {}) {
    this.openDeepLink = options.openDeepLink ?? openMacOSJianyingDeepLink
    this.timeoutMs = options.timeoutMs ?? defaultTransferTimeoutMs
    if (!Number.isSafeInteger(this.timeoutMs) || this.timeoutMs < 1 || this.timeoutMs > 10 * 60_000) {
      throw new Error("JianYing Deep Link timeout must be an integer between 1 and 600000 milliseconds")
    }
  }

  /**
   * Ask JianYing to force-create and activate a blank draft. The native adapter
   * verifies the resulting draft identity before it sends any media.
   */
  async createDraft(signal?: AbortSignal): Promise<void> {
    throwIfAborted(signal)
    await this.openDeepLink(jianyingForceCreateDraftDeepLink, signal)
  }

  async dispatchMaterialImport(
    input: JianyingMaterialImportInput,
    signal?: AbortSignal,
  ): Promise<JianyingMaterialImportEvidence> {
    throwIfAborted(signal)
    const prepared = await prepareMedia(input.media)
    throwIfAborted(signal)

    const states = prepared.map<MutableTransferState>(() => ({ intervals: [], successfulTransfers: 0 }))
    let deepLinkDispatched = false
    let resolveCompleted!: () => void
    const allCompleted = new Promise<void>((resolve) => {
      resolveCompleted = resolve
    })
    const operation = createOperationSignal(signal, this.timeoutMs)
    const sockets = new Set<Socket>()
    const server = createLoopbackServer(prepared, states, operation.signal, () => {
      if (states.every((state, index) => coveredBytes(state.intervals) >= prepared[index].size)) {
        resolveCompleted()
      }
    })
    server.on("connection", (socket) => {
      sockets.add(socket)
      socket.once("close", () => sockets.delete(socket))
    })

    try {
      const port = await listenLoopback(server)
      throwIfAborted(operation.signal)
      const urls = prepared.map((item) => `http://127.0.0.1:${port}${item.endpointPath}`)
      const deepLink = buildJianyingDeepLink(input.target, urls)
      await raceWithAbort(this.openDeepLink(deepLink, operation.signal), operation.signal)
      deepLinkDispatched = true
      await raceWithAbort(allCompleted, operation.signal)
      return snapshotEvidence(input.target, prepared, states, deepLinkDispatched)
    } catch (error) {
      const evidence = snapshotEvidence(input.target, prepared, states, deepLinkDispatched)
      if (operation.timedOut()) {
        throw new JianyingDeepLinkDispatchError(
          `JianYing did not finish reading all staged media within ${this.timeoutMs}ms`,
          "timeout",
          evidence,
          { cause: error },
        )
      }
      if (signal?.aborted) {
        throw new JianyingDeepLinkDispatchError("JianYing material import was cancelled", "cancelled", evidence, {
          cause: abortReason(signal),
        })
      }
      if (!deepLinkDispatched && server.listening) {
        throw new JianyingDeepLinkDispatchError(
          "Could not dispatch the JianYing Deep Link",
          "dispatch_failed",
          evidence,
          {
            cause: error,
          },
        )
      }
      throw new JianyingDeepLinkDispatchError("JianYing loopback media transfer failed", "transport_failed", evidence, {
        cause: error,
      })
    } finally {
      operation.dispose()
      await closeLoopbackServer(server, sockets)
    }
  }
}

/** Production launcher: invoke JianYing by bundle id without a shell or default URL handler. */
export async function openMacOSJianyingDeepLink(url: string, signal?: AbortSignal): Promise<void> {
  assertJianyingDeepLink(url)
  throwIfAborted(signal)
  await new Promise<void>((resolve, reject) => {
    const child = spawn("/usr/bin/open", ["-b", jianyingBundleId, url], {
      stdio: ["ignore", "ignore", "pipe"],
    })
    const stderr: Buffer[] = []
    let stderrBytes = 0
    let settled = false
    const finish = (error?: unknown) => {
      if (settled) return
      settled = true
      signal?.removeEventListener("abort", cancel)
      if (error !== undefined) reject(error)
      else resolve()
    }
    const cancel = () => {
      child.kill("SIGTERM")
    }
    child.stderr?.on("data", (chunk: Buffer) => {
      if (stderrBytes >= 8_192) return
      const bounded = chunk.subarray(0, 8_192 - stderrBytes)
      stderr.push(bounded)
      stderrBytes += bounded.byteLength
    })
    child.once("error", (error) => finish(signal?.aborted ? abortReason(signal) : error))
    child.once("close", (code) => {
      if (signal?.aborted) return finish(abortReason(signal))
      if (code === 0) return finish()
      const detail = Buffer.concat(stderr).toString("utf8").trim()
      finish(
        new Error(`Could not open JianYing Deep Link (exit code ${code ?? "unknown"})${detail ? `: ${detail}` : ""}`),
      )
    })
    signal?.addEventListener("abort", cancel, { once: true })
    if (signal?.aborted) cancel()
  })
}

function buildJianyingDeepLink(target: JianyingDeepLinkTarget, mediaUrls: readonly string[]) {
  const featureEntry = {
    sence: "editor",
    feature: "nothing",
    sence_context: { material_import_by_user: true, new_draft: false },
    feature_context: {
      material_import: true,
      material_infos: mediaUrls.map((materialUri) => ({
        material_uri: materialUri,
        material_param: { add_to_material_panel: true },
      })),
    },
    enter_from: "agent",
    extension: {},
  }
  return `${jianyingDeepLinkBase}?featureEntry=${encodeURIComponent(JSON.stringify(featureEntry))}`
}

async function prepareMedia(media: readonly JianyingDeepLinkMedia[]): Promise<PreparedMedia[]> {
  if (media.length === 0) throw new Error("At least one staged image or video is required")
  return Promise.all(
    media.map(async (item, index) => {
      if (!path.isAbsolute(item.path)) throw new Error(`Staged media ${index + 1} path must be absolute`)
      if (!item.name || /[\u0000-\u001f\u007f]/.test(item.name)) {
        throw new Error(`Staged media ${index + 1} name is invalid`)
      }
      if (!/^(image|video)\/[-A-Za-z0-9!#$&^_.+]+$/.test(item.mimeType)) {
        throw new Error(`Staged media ${index + 1} MIME type is invalid`)
      }
      if (!item.mimeType.startsWith(`${item.mediaType}/`)) {
        throw new Error(`Staged media ${index + 1} type does not match its MIME type`)
      }
      const stat = await fs.lstat(item.path)
      if (!stat.isFile() || !Number.isSafeInteger(stat.size) || stat.size < 1) {
        throw new Error(`Staged media ${index + 1} must be a non-empty regular file`)
      }
      const token = randomBytes(32).toString("hex")
      return {
        ...item,
        endpointPath: `/media/${token}/${encodeURIComponent(item.name)}`,
        size: stat.size,
      }
    }),
  )
}

function createLoopbackServer(
  media: readonly PreparedMedia[],
  states: readonly MutableTransferState[],
  signal: AbortSignal,
  onTransfer: () => void,
) {
  const byPath = new Map(media.map((item, index) => [item.endpointPath, { index, item }]))
  return createServer((request, response) => {
    void (async () => {
      const method = request.method ?? ""
      if (method !== "GET" && method !== "HEAD") {
        response.writeHead(405, { Allow: "GET, HEAD", "Content-Length": "0" })
        response.end()
        return
      }
      const pathname = new URL(request.url ?? "/", "http://127.0.0.1").pathname
      const match = byPath.get(pathname)
      if (!match) {
        response.writeHead(404, { "Content-Length": "0" })
        response.end()
        return
      }
      const range = parseRange(request.headers.range, match.item.size)
      if (range === "unsatisfiable") {
        response.writeHead(416, {
          "Accept-Ranges": "bytes",
          "Content-Length": "0",
          "Content-Range": `bytes */${match.item.size}`,
        })
        response.end()
        return
      }
      const selected = range ?? { start: 0, end: match.item.size - 1 }
      const length = selected.end - selected.start + 1
      const headers: Record<string, string> = {
        "Accept-Ranges": "bytes",
        "Cache-Control": "no-store",
        "Content-Length": String(length),
        "Content-Type": match.item.mimeType,
        "X-Content-Type-Options": "nosniff",
      }
      if (range) headers["Content-Range"] = `bytes ${selected.start}-${selected.end}/${match.item.size}`
      response.writeHead(range ? 206 : 200, headers)
      if (method === "HEAD") {
        response.end()
        return
      }
      throwIfAborted(signal)
      let transferredBytes = 0
      const stream = createReadStream(match.item.path, {
        end: selected.end,
        signal,
        start: selected.start,
      })
      stream.on("data", (chunk) => {
        transferredBytes += typeof chunk === "string" ? Buffer.byteLength(chunk) : chunk.byteLength
      })
      await pipeline(stream, response)
      if (transferredBytes !== length) {
        throw new Error("A staged JianYing media file changed during transfer")
      }
      const state = states[match.index]
      state.successfulTransfers += 1
      state.intervals = mergeInterval(state.intervals, [selected.start, selected.end])
      onTransfer()
    })().catch((error) => failResponse(response, error))
  })
}

function parseRange(header: string | undefined, size: number): ByteRange | "unsatisfiable" | undefined {
  if (header === undefined) return undefined
  const match = /^bytes=(\d*)-(\d*)$/.exec(header)
  if (!match || (!match[1] && !match[2])) return "unsatisfiable"
  if (!match[1]) {
    const suffix = Number(match[2])
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return "unsatisfiable"
    return { start: Math.max(0, size - suffix), end: size - 1 }
  }
  const start = Number(match[1])
  const requestedEnd = match[2] ? Number(match[2]) : size - 1
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(requestedEnd) ||
    start < 0 ||
    start >= size ||
    requestedEnd < start
  ) {
    return "unsatisfiable"
  }
  return { start, end: Math.min(requestedEnd, size - 1) }
}

function mergeInterval(
  intervals: Array<readonly [number, number]>,
  incoming: readonly [number, number],
): Array<readonly [number, number]> {
  const sorted = [...intervals, incoming].sort((left, right) => left[0] - right[0])
  const merged: Array<readonly [number, number]> = []
  for (const interval of sorted) {
    const previous = merged.at(-1)
    if (!previous || interval[0] > previous[1] + 1) {
      merged.push(interval)
    } else {
      merged[merged.length - 1] = [previous[0], Math.max(previous[1], interval[1])]
    }
  }
  return merged
}

function coveredBytes(intervals: readonly (readonly [number, number])[]) {
  return intervals.reduce((total, [start, end]) => total + end - start + 1, 0)
}

function snapshotEvidence(
  target: JianyingDeepLinkTarget,
  media: readonly PreparedMedia[],
  states: readonly MutableTransferState[],
  deepLinkDispatched: boolean,
): JianyingMaterialImportEvidence {
  return {
    deepLinkDispatched,
    items: media.map((item, index) => {
      const state = states[index]
      const bytes = coveredBytes(state.intervals)
      return {
        bytes,
        completed: bytes >= item.size,
        mediaType: item.mediaType,
        mimeType: item.mimeType,
        name: item.name,
        size: item.size,
        successfulTransfers: state.successfulTransfers,
      }
    }),
    target,
  }
}

function createOperationSignal(external: AbortSignal | undefined, timeoutMs: number) {
  const controller = new AbortController()
  let timedOut = false
  const cancel = () => controller.abort(abortReason(external!))
  if (external?.aborted) {
    cancel()
  } else {
    external?.addEventListener("abort", cancel, { once: true })
  }
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort(new TransferTimeoutError())
  }, timeoutMs)
  return {
    dispose() {
      clearTimeout(timer)
      external?.removeEventListener("abort", cancel)
    },
    signal: controller.signal,
    timedOut: () => timedOut,
  }
}

function raceWithAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(abortReason(signal))
  return new Promise<T>((resolve, reject) => {
    const cancel = () => {
      signal.removeEventListener("abort", cancel)
      reject(abortReason(signal))
    }
    signal.addEventListener("abort", cancel, { once: true })
    if (signal.aborted) cancel()
    promise.then(
      (value) => {
        signal.removeEventListener("abort", cancel)
        resolve(value)
      },
      (error) => {
        signal.removeEventListener("abort", cancel)
        reject(error)
      },
    )
  })
}

function listenLoopback(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error) => reject(error)
    server.once("error", onError)
    server.listen(0, "127.0.0.1", () => {
      server.removeListener("error", onError)
      const address = server.address()
      if (!address || typeof address === "string" || address.address !== "127.0.0.1") {
        reject(new Error("JianYing media server did not bind to IPv4 loopback"))
        return
      }
      resolve(address.port)
    })
  })
}

async function closeLoopbackServer(server: Server, sockets: ReadonlySet<Socket>) {
  for (const socket of sockets) socket.destroy()
  if (!server.listening) return
  await new Promise<void>((resolve) => server.close(() => resolve()))
}

function failResponse(response: ServerResponse, error: unknown) {
  if (response.destroyed || response.writableEnded) return
  if (!response.headersSent) {
    response.writeHead(500, { "Content-Length": "0" })
    response.end()
    return
  }
  response.destroy(error instanceof Error ? error : undefined)
}

function assertJianyingDeepLink(input: string) {
  const url = new URL(input)
  const isMaterialImport =
    url.pathname === "/uganchor/anchor_point/nothing" &&
    url.searchParams.size === 1 &&
    url.searchParams.has("featureEntry")
  const isForceCreateDraft =
    url.pathname === "/main/draft/new_draft" &&
    url.searchParams.size === 1 &&
    url.searchParams.get("force_create") === "true"
  if (
    url.protocol !== "videocut:" ||
    url.hostname !== "com.ies.videocut" ||
    (!isMaterialImport && !isForceCreateDraft) ||
    url.username ||
    url.password ||
    url.hash
  ) {
    throw new Error("Refusing to open an unexpected JianYing Deep Link")
  }
}

function abortReason(signal: AbortSignal) {
  return signal.reason instanceof Error ? signal.reason : new DOMException("Operation was cancelled", "AbortError")
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw abortReason(signal)
}
