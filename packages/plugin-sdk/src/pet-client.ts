import {
  isPetHostConnect,
  isPetHostMethodForSurface,
  isPetHostMessageWithinLimit,
  parsePetHostEvent,
  parsePetHostParams,
  parsePetHostResult,
  petHostMaximumPendingRequests,
  petHostProtocol,
  type PetHostEventContract,
  type PetHostEventName,
  type PetHostMethodForSurface,
  type PetHostParams,
  type PetHostResult,
  type PetHostSurface,
} from "./pet"

export * from "./pet"

const defaultHandshakeTimeoutMs = 5_000
const defaultRequestTimeoutMs = 10_000
const maximumTimeoutMs = 60_000
const minimumTimeoutMs = 25

export interface PetHostMessageEvent {
  readonly data: unknown
  readonly ports?: readonly PetHostMessagePort[]
  readonly source: unknown
}

export interface PetHostMessagePort {
  close(): void
  onmessage: ((event: { readonly data: unknown }) => void) | null
  postMessage(message: unknown): void
  start?(): void
}

export interface PetHostWindow {
  readonly location: { readonly hostname: string; readonly protocol: string }
  readonly parent: unknown
  addEventListener(type: "message", listener: (event: PetHostMessageEvent) => void): void
  removeEventListener(type: "message", listener: (event: PetHostMessageEvent) => void): void
}

export interface ConnectPetHostOptions<Surface extends PetHostSurface> {
  readonly handshakeTimeoutMs?: number
  readonly requestTimeoutMs?: number
  /** Test and non-browser adapter seam. Browser Plugins should omit this. */
  readonly source?: PetHostWindow
  readonly surface: Surface
}

export interface PetHostAbortSignal {
  readonly aborted: boolean
  readonly reason?: unknown
  addEventListener(type: "abort", listener: () => void, options?: { readonly once?: boolean }): void
  removeEventListener(type: "abort", listener: () => void): void
}

export interface PetHostRequestOptions {
  readonly signal?: PetHostAbortSignal
}

export interface PetHostClient<Surface extends PetHostSurface> {
  readonly closed: boolean
  readonly surface: Surface
  close(): void
  request<Method extends PetHostMethodForSurface<Surface>>(
    method: Method,
    params: PetHostParams<Method>,
    options?: PetHostRequestOptions,
  ): Promise<PetHostResult<Method>>
  subscribe<Event extends PetHostEventName>(
    event: Event,
    listener: (payload: PetHostEventContract[Event]) => void,
  ): () => void
}

export class PetHostClientError extends Error {
  readonly code:
    | "aborted"
    | "closed"
    | "invalid-message"
    | "overloaded"
    | "remote-error"
    | "timeout"
    | "transport-error"

  constructor(code: PetHostClientError["code"], message: string) {
    super(message)
    this.name = "PetHostClientError"
    this.code = code
  }
}

interface PendingRequest {
  readonly abort?: () => void
  readonly method: PetHostMethodForSurface<PetHostSurface>
  readonly reject: (error: unknown) => void
  readonly resolve: (value: unknown) => void
  readonly timeout: unknown
}

interface PetHostTimers {
  clearTimeout(handle: unknown): void
  setTimeout(handler: () => void, milliseconds: number): unknown
}

function timers(): PetHostTimers {
  const value = globalThis as unknown as Partial<PetHostTimers>
  if (typeof value.setTimeout !== "function" || typeof value.clearTimeout !== "function") {
    throw new PetHostClientError("transport-error", "Pet Host client requires browser timers")
  }
  return value as PetHostTimers
}

function browserWindow(): PetHostWindow {
  const value = globalThis as unknown as Partial<PetHostWindow>
  if (
    !value.location ||
    typeof value.location.hostname !== "string" ||
    typeof value.location.protocol !== "string" ||
    typeof value.addEventListener !== "function" ||
    typeof value.removeEventListener !== "function"
  ) {
    throw new PetHostClientError("transport-error", "Pet Host client requires a browser Plugin surface")
  }
  return value as PetHostWindow
}

function timeoutFor(value: number | undefined, fallback: number) {
  if (value === undefined) return fallback
  if (!Number.isFinite(value)) throw new TypeError("Pet Host timeout is invalid")
  return Math.min(maximumTimeoutMs, Math.max(minimumTimeoutMs, Math.trunc(value)))
}

function record(value: unknown): Record<string, unknown> | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null ? (value as Record<string, unknown>) : undefined
}

function clientForPort<Surface extends PetHostSurface>(
  port: PetHostMessagePort,
  requestTimeoutMs: number,
  surface: Surface,
): PetHostClient<Surface> {
  const timerHost = timers()
  const listeners = new Map<PetHostEventName, Set<(payload: never) => void>>()
  const pending = new Map<string, PendingRequest>()
  let closed = false
  let nextId = 0

  const close = () => {
    if (closed) return
    closed = true
    port.onmessage = null
    for (const request of pending.values()) {
      timerHost.clearTimeout(request.timeout)
      request.abort?.()
      request.reject(new PetHostClientError("closed", "Pet Host connection closed"))
    }
    pending.clear()
    listeners.clear()
    try {
      port.close()
    } catch {}
  }

  port.onmessage = ({ data }) => {
    if (closed) return
    if (!isPetHostMessageWithinLimit(data)) {
      close()
      return
    }
    const message = record(data)
    if (!message || message.protocol !== petHostProtocol) {
      close()
      return
    }
    if (message.type === "event") {
      try {
        const event = parsePetHostEvent(data)
        for (const listener of listeners.get(event.event) ?? []) listener(event.payload as never)
      } catch {
        close()
      }
      return
    }
    if (message.type !== "response" || typeof message.id !== "string") {
      close()
      return
    }
    const request = pending.get(message.id)
    if (!request) {
      close()
      return
    }
    pending.delete(message.id)
    timerHost.clearTimeout(request.timeout)
    request.abort?.()
    const keys = Object.keys(message)
    if (
      message.ok === false &&
      typeof message.error === "string" &&
      keys.length === 5 &&
      keys.every((key) => ["error", "id", "ok", "protocol", "type"].includes(key))
    ) {
      request.reject(new PetHostClientError("remote-error", message.error.slice(0, 500) || "Pet Host request failed"))
      return
    }
    if (
      message.ok !== true ||
      keys.length !== 5 ||
      !keys.every((key) => ["id", "ok", "protocol", "result", "type"].includes(key)) ||
      !Object.prototype.hasOwnProperty.call(message, "result")
    ) {
      request.reject(new PetHostClientError("invalid-message", "Pet Host response is invalid"))
      close()
      return
    }
    try {
      request.resolve(parsePetHostResult(request.method, message.result))
    } catch {
      request.reject(new PetHostClientError("invalid-message", "Pet Host result is invalid"))
      close()
    }
  }
  port.start?.()

  return Object.freeze({
    get closed() {
      return closed
    },
    surface,
    close,
    request<Method extends PetHostMethodForSurface<Surface>>(
      method: Method,
      params: PetHostParams<Method>,
      options?: PetHostRequestOptions,
    ) {
      if (closed) return Promise.reject(new PetHostClientError("closed", "Pet Host connection closed"))
      if (options?.signal?.aborted) {
        return Promise.reject(new PetHostClientError("aborted", "Pet Host request was aborted"))
      }
      if (pending.size >= petHostMaximumPendingRequests) {
        return Promise.reject(new PetHostClientError("overloaded", "Pet Host pending request limit reached"))
      }
      if (!isPetHostMethodForSurface(surface, method)) {
        return Promise.reject(new PetHostClientError("invalid-message", "Pet Host method is invalid for this surface"))
      }
      let parsedParams: PetHostParams<Method>
      try {
        parsedParams = parsePetHostParams(method, params)
      } catch {
        return Promise.reject(new PetHostClientError("invalid-message", "Pet Host request params are invalid"))
      }
      const request = {
        id: `${surface}-${++nextId}`,
        method,
        params: parsedParams,
        protocol: petHostProtocol,
        type: "request" as const,
      }
      if (!isPetHostMessageWithinLimit(request)) {
        return Promise.reject(new PetHostClientError("invalid-message", "Pet Host request is invalid"))
      }
      return new Promise<PetHostResult<Method>>((resolve, reject) => {
        const abort = options?.signal
          ? () => {
              options.signal?.removeEventListener("abort", abortListener)
            }
          : undefined
        const abortListener = () => {
          if (!pending.delete(request.id)) return
          timerHost.clearTimeout(timeout)
          abort?.()
          reject(new PetHostClientError("aborted", "Pet Host request was aborted"))
        }
        const timeout = timerHost.setTimeout(() => {
          if (!pending.delete(request.id)) return
          abort?.()
          reject(new PetHostClientError("timeout", "Pet Host request timed out"))
        }, requestTimeoutMs)
        pending.set(request.id, {
          abort,
          method,
          reject,
          resolve: resolve as (value: unknown) => void,
          timeout,
        })
        options?.signal?.addEventListener("abort", abortListener, { once: true })
        try {
          port.postMessage(request)
        } catch (error) {
          timerHost.clearTimeout(timeout)
          pending.delete(request.id)
          abort?.()
          reject(
            new PetHostClientError(
              "transport-error",
              error instanceof Error ? error.message : "Pet Host request transport failed",
            ),
          )
        }
      })
    },
    subscribe<Event extends PetHostEventName>(
      event: Event,
      listener: (payload: PetHostEventContract[Event]) => void,
    ) {
      if (closed) return () => undefined
      const eventListeners = listeners.get(event) ?? new Set<(payload: never) => void>()
      eventListeners.add(listener as (payload: never) => void)
      listeners.set(event, eventListeners)
      return () => {
        eventListeners.delete(listener as (payload: never) => void)
        if (eventListeners.size === 0) listeners.delete(event)
      }
    },
  })
}

/**
 * Connects the current Pet contribution surface to its Host-owned snapshot.
 * Plugin identity is derived from the immutable `convax-plugin:` origin and is
 * intentionally absent from author options.
 */
export function connectPetHost<const Surface extends PetHostSurface>(
  options: ConnectPetHostOptions<Surface>,
): Promise<PetHostClient<Surface>> {
  const source = options.source ?? browserWindow()
  if (source.location.protocol !== "convax-plugin:" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(source.location.hostname)) {
    return Promise.reject(new PetHostClientError("transport-error", "Pet Host Plugin origin is invalid"))
  }
  const handshakeTimeoutMs = timeoutFor(options.handshakeTimeoutMs, defaultHandshakeTimeoutMs)
  const requestTimeoutMs = timeoutFor(options.requestTimeoutMs, defaultRequestTimeoutMs)
  const timerHost = timers()
  return new Promise((resolve, reject) => {
    let settled = false
    const cleanup = () => {
      source.removeEventListener("message", connect)
      timerHost.clearTimeout(timeout)
    }
    const connect = (event: PetHostMessageEvent) => {
      if (
        settled ||
        event.source !== source.parent ||
        event.ports?.length !== 1 ||
        !isPetHostConnect(event.data, options.surface, source.location.hostname)
      ) {
        return
      }
      settled = true
      cleanup()
      resolve(clientForPort(event.ports[0]!, requestTimeoutMs, options.surface))
    }
    source.addEventListener("message", connect)
    const timeout = timerHost.setTimeout(() => {
      if (settled) return
      settled = true
      cleanup()
      reject(new PetHostClientError("timeout", "Pet Host connection timed out"))
    }, handshakeTimeoutMs)
  })
}
