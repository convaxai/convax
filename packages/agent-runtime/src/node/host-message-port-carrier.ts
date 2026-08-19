import { randomUUID } from "node:crypto"

import { AbstractApiClient } from "@deepseek-ai/dsh-host-apiproxy/client"

import "./dsh-disposable-compat"

const maximumFrameBytes = 8 * 1024 * 1024

export interface HostMessagePort {
  close(): void
  onMessage(listener: (message: unknown) => void): () => void
  postMessage(message: unknown): void
}

type RequestFrame = {
  body?: Uint8Array
  headers: [string, string][]
  id: string
  method: string
  type: "fetch/request"
  url: string
}

type CancelFrame = { id: string; type: "fetch/cancel" }
type ResponseFrame = {
  headers: [string, string][]
  id: string
  status: number
  statusText: string
  type: "fetch/response"
}
type ChunkFrame = { chunk: Uint8Array; id: string; type: "fetch/chunk" }
type EndFrame = { id: string; type: "fetch/end" }
type ErrorFrame = { id: string; message: string; type: "fetch/error" }
type CarrierFrame = RequestFrame | CancelFrame | ResponseFrame | ChunkFrame | EndFrame | ErrorFrame

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function frame(value: unknown): CarrierFrame | null {
  const input = record(value)
  if (!input || typeof input.type !== "string" || typeof input.id !== "string" || !input.id) return null
  switch (input.type) {
    case "fetch/cancel":
    case "fetch/end":
      return input as CarrierFrame
    case "fetch/error":
      return typeof input.message === "string" ? (input as CarrierFrame) : null
    case "fetch/chunk":
      return input.chunk instanceof Uint8Array && input.chunk.byteLength <= maximumFrameBytes
        ? (input as CarrierFrame)
        : null
    case "fetch/response":
      return Number.isInteger(input.status) && Array.isArray(input.headers) && typeof input.statusText === "string"
        ? (input as CarrierFrame)
        : null
    case "fetch/request":
      return typeof input.url === "string" &&
        typeof input.method === "string" &&
        Array.isArray(input.headers) &&
        (input.body === undefined || (input.body instanceof Uint8Array && input.body.byteLength <= maximumFrameBytes))
        ? (input as CarrierFrame)
        : null
    default:
      return null
  }
}

interface PendingFetch {
  abort(): void
  controller?: ReadableStreamDefaultController<Uint8Array>
  reject(error: unknown): void
  resolve(response: Response): void
  responded: boolean
}

/** Fetch-shaped transport aspect for DSH AbstractApiClient; no Host business method is redeclared here. */
export class MessagePortApiClient extends AbstractApiClient {
  private readonly pending = new Map<string, PendingFetch>()
  private readonly unsubscribe: () => void
  private closed = false

  constructor(
    private readonly port: HostMessagePort,
    timeoutMs?: number,
  ) {
    super(timeoutMs)
    this.unsubscribe = port.onMessage((message) => this.receive(message))
  }

  protected async doFetch(input: URL, init?: RequestInit): Promise<Response> {
    if (this.closed) throw new Error("DSH MessagePort carrier is closed")
    const body =
      init?.body === undefined || init.body === null
        ? undefined
        : new Uint8Array(await new Response(init.body).arrayBuffer())
    if (body && body.byteLength > maximumFrameBytes) throw new Error("DSH carrier request exceeds the frame limit")
    const id = randomUUID()
    return new Promise<Response>((resolve, reject) => {
      const abort = () => {
        this.port.postMessage({ id, type: "fetch/cancel" } satisfies CancelFrame)
        const pending = this.pending.get(id)
        if (!pending) return
        this.pending.delete(id)
        const error = init?.signal?.reason ?? new DOMException("The operation was aborted", "AbortError")
        if (pending.responded) pending.controller?.error(error)
        else pending.reject(error)
      }
      if (init?.signal?.aborted) return abort()
      init?.signal?.addEventListener("abort", abort, { once: true })
      this.pending.set(id, { abort, reject, resolve, responded: false })
      this.port.postMessage({
        ...(body ? { body } : {}),
        headers: [...new Headers(init?.headers).entries()],
        id,
        method: init?.method ?? "GET",
        type: "fetch/request",
        url: input.href,
      } satisfies RequestFrame)
    })
  }

  private receive(value: unknown) {
    const message = frame(value)
    if (!message || message.type === "fetch/request" || message.type === "fetch/cancel") {
      this.dispose(new Error("DSH carrier received a malformed or wrong-direction frame"))
      return
    }
    const pending = this.pending.get(message.id)
    if (!pending) return
    if (message.type === "fetch/response") {
      if (pending.responded) return this.fail(message.id, new Error("DSH carrier received a duplicate response"))
      pending.responded = true
      const body = new ReadableStream<Uint8Array>({
        start: (controller) => {
          pending.controller = controller
        },
        cancel: () => pending.abort(),
      })
      pending.resolve(
        new Response(body, {
          headers: message.headers,
          status: message.status,
          statusText: message.statusText,
        }),
      )
      return
    }
    if (!pending.responded) return this.fail(message.id, new Error("DSH carrier received data before response headers"))
    if (message.type === "fetch/chunk") pending.controller?.enqueue(message.chunk)
    else if (message.type === "fetch/end") {
      this.pending.delete(message.id)
      pending.controller?.close()
    } else this.fail(message.id, new Error(message.message))
  }

  private fail(id: string, error: unknown) {
    const pending = this.pending.get(id)
    if (!pending) return
    this.pending.delete(id)
    if (pending.responded) pending.controller?.error(error)
    else pending.reject(error)
  }

  dispose(reason: unknown = new Error("DSH MessagePort carrier closed")) {
    if (this.closed) return
    this.closed = true
    this.unsubscribe()
    this.port.close()
    for (const id of this.pending.keys()) this.fail(id, reason)
  }
}

/** Child-side bridge from physical fetch frames to DSH's official toFetchHandler output. */
export function serveHostFetchOverMessagePort(
  port: HostMessagePort,
  handler: { fetch(input: Request): Promise<Response> },
) {
  const requests = new Map<string, AbortController>()
  let closed = false
  const send = (message: CarrierFrame) => {
    if (!closed) port.postMessage(message)
  }
  let unsubscribe = () => {}
  const dispose = () => {
    if (closed) return
    closed = true
    unsubscribe()
    for (const request of requests.values()) request.abort(new Error("DSH carrier closed"))
    requests.clear()
    port.close()
  }
  unsubscribe = port.onMessage((value) => {
    const message = frame(value)
    if (!message || (message.type !== "fetch/request" && message.type !== "fetch/cancel")) {
      dispose()
      return
    }
    if (message.type === "fetch/cancel") {
      requests.get(message.id)?.abort(new DOMException("Parent cancelled the DSH request", "AbortError"))
      return
    }
    if (requests.has(message.id)) {
      dispose()
      return
    }
    const abort = new AbortController()
    requests.set(message.id, abort)
    void (async () => {
      try {
        const body = message.body ? Uint8Array.from(message.body).buffer : undefined
        const response = await handler.fetch(
          new Request(message.url, {
            ...(body ? { body } : {}),
            headers: message.headers,
            method: message.method,
            signal: abort.signal,
          }),
        )
        send({
          headers: [...response.headers.entries()],
          id: message.id,
          status: response.status,
          statusText: response.statusText,
          type: "fetch/response",
        })
        if (response.body) {
          const reader = response.body.getReader()
          for (;;) {
            const { done, value: chunk } = await reader.read()
            if (done) break
            for (let offset = 0; offset < chunk.byteLength; offset += maximumFrameBytes) {
              send({ chunk: chunk.slice(offset, offset + maximumFrameBytes), id: message.id, type: "fetch/chunk" })
            }
          }
        }
        send({ id: message.id, type: "fetch/end" })
      } catch (error) {
        send({ id: message.id, message: error instanceof Error ? error.message : String(error), type: "fetch/error" })
      } finally {
        requests.delete(message.id)
      }
    })()
  })
  return dispose
}
