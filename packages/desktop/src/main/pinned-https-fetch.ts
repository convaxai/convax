import dns from "node:dns/promises"
import type { ClientRequest, IncomingMessage } from "node:http"
import https, { type RequestOptions } from "node:https"

export type MarketplaceFetchPurpose = "descriptor" | "registry" | "release" | "showcase"

export interface MarketplaceRepositoryIdentity {
  owner: string
  repository: string
}

export interface PinnedHttpsFetchOptions {
  declaredUrl?: string
  maxBytes?: number
  redirectLimit?: number
  repository?: MarketplaceRepositoryIdentity
  signal?: AbortSignal
  /** Maximum time without TLS, response, or body progress. */
  timeoutMs?: number
}

type RequestTransport = (
  options: RequestOptions,
  onResponse: (response: IncomingMessage) => void,
) => ClientRequest

export interface PinnedHttpsFetcherOptions {
  /** Test-only seams; production composition must use the defaults. */
  testing?: {
    connectPort?: number
    isPublicAddress?: (address: string, family: 4 | 6) => boolean
    request?: RequestTransport
    resolve?: typeof dns.lookup
  }
}

const blockedIpv4 = createBlockedSubnets(4, [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const)
const blockedIpv6 = createBlockedSubnets(6, [
  ["::", 128],
  ["::1", 128],
  ["::", 96],
  ["::ffff:0:0", 96],
  ["64:ff9b::", 96],
  ["64:ff9b:1::", 48],
  ["100::", 64],
  ["2001::", 23],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["fec0::", 10],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
] as const)

export function isPublicMarketplaceAddress(address: string, family: 4 | 6) {
  const bytes = parseAddressBytes(address, family)
  if (!bytes) return false
  const blocked = family === 4 ? blockedIpv4 : blockedIpv6
  return !blocked.some((subnet) => matchesSubnet(bytes, subnet))
}

type BlockedSubnet = Readonly<{ bytes: Uint8Array; prefix: number }>

function createBlockedSubnets(
  family: 4 | 6,
  entries: readonly (readonly [network: string, prefix: number])[],
): readonly BlockedSubnet[] {
  return entries.map(([network, prefix]) => {
    const bytes = parseAddressBytes(network, family)
    if (!bytes) throw new TypeError("Marketplace blocked subnet is invalid")
    return Object.freeze({ bytes, prefix })
  })
}

function matchesSubnet(address: Uint8Array, subnet: BlockedSubnet): boolean {
  const completeBytes = Math.floor(subnet.prefix / 8)
  for (let index = 0; index < completeBytes; index += 1) {
    if (address[index] !== subnet.bytes[index]) return false
  }
  const remainingBits = subnet.prefix % 8
  if (remainingBits === 0) return true
  const mask = (0xff << (8 - remainingBits)) & 0xff
  return (address[completeBytes]! & mask) === (subnet.bytes[completeBytes]! & mask)
}

function parseAddressBytes(address: string, family: 4 | 6): Uint8Array | undefined {
  return family === 4 ? parseIpv4Bytes(address) : parseIpv6Bytes(address)
}

function parseIpv4Bytes(address: string): Uint8Array | undefined {
  const parts = address.split(".")
  if (parts.length !== 4) return undefined
  const bytes = new Uint8Array(4)
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index]!
    if (!/^(?:0|[1-9]\d{0,2})$/u.test(part)) return undefined
    const value = Number(part)
    if (value > 255) return undefined
    bytes[index] = value
  }
  return bytes
}

function parseIpv6Bytes(address: string): Uint8Array | undefined {
  if (address === "" || address.includes("%")) return undefined
  let normalized = address.toLowerCase()
  if (normalized.includes(".")) {
    const separator = normalized.lastIndexOf(":")
    if (separator < 0) return undefined
    const suffix = parseIpv4Bytes(normalized.slice(separator + 1))
    if (!suffix) return undefined
    const high = ((suffix[0]! << 8) | suffix[1]!).toString(16)
    const low = ((suffix[2]! << 8) | suffix[3]!).toString(16)
    normalized = `${normalized.slice(0, separator)}:${high}:${low}`
  }

  const halves = normalized.split("::")
  if (halves.length > 2) return undefined
  const left = parseIpv6Groups(halves[0]!)
  const right = halves.length === 2 ? parseIpv6Groups(halves[1]!) : []
  if (!left || !right) return undefined
  const omitted = 8 - left.length - right.length
  if ((halves.length === 1 && omitted !== 0) || (halves.length === 2 && omitted < 1)) return undefined
  const groups = [...left, ...Array.from({ length: omitted }, () => 0), ...right]
  if (groups.length !== 8) return undefined
  const bytes = new Uint8Array(16)
  for (let index = 0; index < groups.length; index += 1) {
    bytes[index * 2] = groups[index]! >>> 8
    bytes[index * 2 + 1] = groups[index]! & 0xff
  }
  return bytes
}

function parseIpv6Groups(value: string): number[] | undefined {
  if (value === "") return []
  const groups = value.split(":")
  const parsed: number[] = []
  for (const group of groups) {
    if (!/^[0-9a-f]{1,4}$/u.test(group)) return undefined
    parsed.push(Number.parseInt(group, 16))
  }
  return parsed
}

function abortError(reason?: unknown) {
  const error = reason instanceof Error ? reason : new Error("Marketplace request was canceled")
  error.name = "AbortError"
  return error
}

function exactUrl(input: string, allowQuery = false) {
  let url: URL
  try {
    url = new URL(input)
  } catch {
    throw new Error("Marketplace URL is invalid")
  }
  if (
    url.protocol !== "https:" ||
    url.port !== "" ||
    url.username !== "" ||
    url.password !== "" ||
    (!allowQuery && url.search !== "") ||
    url.hash !== ""
  ) {
    throw new Error("Marketplace URL must be fixed HTTPS on port 443")
  }
  return url
}

export function marketplaceRepositoryFromDescriptorUrl(input: string): MarketplaceRepositoryIdentity {
  const url = exactUrl(input)
  const hostname = url.hostname.toLowerCase()
  const owner = hostname.endsWith(".github.io") ? hostname.slice(0, -".github.io".length) : ""
  const match = url.pathname.match(/^\/([A-Za-z0-9_.-]+)\/marketplace\.json$/u)
  if (!owner || !/^[a-z0-9](?:[a-z0-9-]{0,38})$/u.test(owner) || !match) {
    throw new Error("Marketplace descriptor must use the repository GitHub Pages URL")
  }
  return { owner, repository: match[1]! }
}

function validatePurposeUrl(
  input: string,
  purpose: MarketplaceFetchPurpose,
  repository?: MarketplaceRepositoryIdentity,
  redirected = false,
  declaredUrl?: string,
) {
  const url = exactUrl(input, redirected && purpose === "release")
  if (purpose === "descriptor") return { repository: marketplaceRepositoryFromDescriptorUrl(input), url }
  if (!repository) throw new Error("Marketplace repository binding is required")
  const pagesHost = `${repository.owner}.github.io`
  if (purpose === "registry" || purpose === "showcase") {
    if (
      !declaredUrl ||
      url.href !== exactUrl(declaredUrl).href ||
      url.hostname.toLowerCase() !== pagesHost ||
      !url.pathname.startsWith(`/${repository.repository}/`)
    ) {
      throw new Error(`Marketplace ${purpose} URL does not match its GitHub Pages repository`)
    }
    return { repository, url }
  }
  const hostname = url.hostname.toLowerCase()
  if (
    redirected &&
    (hostname === "release-assets.githubusercontent.com" || hostname === "objects.githubusercontent.com") &&
    url.pathname.length > 1
  ) {
    return { repository, url }
  }
  const segments = url.pathname.split("/").filter(Boolean)
  const encodedSegments = url.pathname.split("/").slice(1)
  const safeReleaseCoordinate = (value: string) => {
    if (/%2f|%5c/iu.test(value)) return false
    let decoded: string
    try {
      decoded = decodeURIComponent(value)
    } catch {
      return false
    }
    return /^[A-Za-z0-9][A-Za-z0-9._+-]{0,254}$/u.test(decoded)
  }
  if (
    redirected ||
    hostname !== "github.com" ||
    segments.length !== 6 ||
    encodedSegments.length !== 6 ||
    segments[0] !== repository.owner ||
    segments[1] !== repository.repository ||
    segments[2] !== "releases" ||
    segments[3] !== "download" ||
    segments[4] === "latest" ||
    !safeReleaseCoordinate(encodedSegments[4]!) ||
    !safeReleaseCoordinate(encodedSegments[5]!)
  ) {
    throw new Error("Marketplace Release URL does not match its immutable GitHub repository")
  }
  return { repository, url }
}

export class PinnedHttpsFetcher {
  readonly #connectPort?: number
  readonly #isPublicAddress: (address: string, family: 4 | 6) => boolean
  readonly #request: RequestTransport
  readonly #resolve: typeof dns.lookup

  constructor(options: PinnedHttpsFetcherOptions = {}) {
    this.#connectPort = options.testing?.connectPort
    this.#isPublicAddress = options.testing?.isPublicAddress ?? isPublicMarketplaceAddress
    this.#request =
      options.testing?.request ??
      ((requestOptions, onResponse) => https.request(requestOptions, onResponse))
    this.#resolve = options.testing?.resolve ?? dns.lookup
  }

  async fetch(
    input: string,
    purpose: MarketplaceFetchPurpose,
    options: PinnedHttpsFetchOptions = {},
  ): Promise<Uint8Array> {
    const initial = validatePurposeUrl(input, purpose, options.repository, false, options.declaredUrl)
    return this.#fetch(initial.url, purpose, initial.repository, options, 0)
  }

  async #fetch(
    url: URL,
    purpose: MarketplaceFetchPurpose,
    repository: MarketplaceRepositoryIdentity,
    options: PinnedHttpsFetchOptions,
    redirects: number,
  ): Promise<Uint8Array> {
    if (options.signal?.aborted) throw abortError(options.signal.reason)
    const redirectLimit = options.redirectLimit ?? 3
    const maxBytes = options.maxBytes ?? 8 * 1024 * 1024
    const timeoutMs = options.timeoutMs ?? 15_000
    if (!Number.isSafeInteger(redirectLimit) || redirectLimit < 0 || redirectLimit > 5) {
      throw new Error("Marketplace redirect limit is invalid")
    }
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 128 * 1024 * 1024) {
      throw new Error("Marketplace response byte limit is invalid")
    }
    const answers = await this.#resolve(url.hostname, { all: true, verbatim: true })
    if (answers.length === 0) throw new Error("Marketplace host did not resolve")
    const normalized = answers
      .map(({ address, family }) => ({ address, family: family as 4 | 6 }))
      .sort((left, right) => left.family - right.family || left.address.localeCompare(right.address, "en"))
    if (normalized.some(({ address, family }) => !this.#isPublicAddress(address, family))) {
      throw new Error("Marketplace host resolved to a non-public address")
    }
    const selected = normalized[0]!
    const response = await new Promise<{
      body: Uint8Array
      location?: string
      status: number
    }>((resolve, reject) => {
      let settled = false
      let timer: ReturnType<typeof setTimeout> | undefined
      let destroyIncoming: ((error: Error) => void) | undefined
      let resetTimeout: () => void = () => undefined
      const clearRequestTimeout = () => {
        if (!timer) return
        clearTimeout(timer)
        timer = undefined
      }
      const fail = (error: unknown) => {
        if (settled) return
        settled = true
        clearRequestTimeout()
        reject(error)
      }
      const request = this.#request(
        {
          agent: false,
          headers: { accept: "application/json", "accept-encoding": "identity" },
          hostname: url.hostname,
          lookup: (_hostname, lookupOptions, callback) => {
            if (typeof lookupOptions === "object" && lookupOptions.all) {
              ;(callback as unknown as (error: null, addresses: Array<{ address: string; family: number }>) => void)(
                null,
                [selected],
              )
            } else {
              callback(null, selected.address, selected.family)
            }
          },
          method: "GET",
          path: `${url.pathname}${url.search}`,
          port: this.#connectPort ?? 443,
          servername: url.hostname,
        },
        (incoming) => {
          destroyIncoming = (error) => incoming.destroy(error)
          resetTimeout()
          const status = incoming.statusCode ?? 0
          const location = incoming.headers.location
          if (status >= 300 && status < 400) {
            incoming.resume()
            if (!location) return fail(new Error("Marketplace redirect is missing Location"))
            if (!settled) {
              settled = true
              clearRequestTimeout()
              resolve({ body: new Uint8Array(), location, status })
            }
            return
          }
          if (status !== 200) {
            incoming.resume()
            return fail(new Error(`Marketplace request failed with HTTP ${status}`))
          }
          const encoding = incoming.headers["content-encoding"]
          if (encoding && encoding !== "identity") {
            incoming.destroy()
            return fail(new Error("Marketplace response compression is not admitted"))
          }
          const declared = incoming.headers["content-length"]
          if (declared && (!/^\d+$/u.test(declared) || Number(declared) > maxBytes)) {
            incoming.destroy()
            return fail(new Error("Marketplace response exceeds its byte limit"))
          }
          const chunks: Buffer[] = []
          let size = 0
          incoming.on("data", (chunk: Buffer) => {
            resetTimeout()
            size += chunk.byteLength
            if (size > maxBytes) {
              incoming.destroy()
              fail(new Error("Marketplace response exceeds its byte limit"))
            } else {
              chunks.push(Buffer.from(chunk))
            }
          })
          incoming.once("end", () => {
            if (settled) return
            settled = true
            clearRequestTimeout()
            resolve({ body: Buffer.concat(chunks, size), status })
          })
          incoming.once("error", fail)
        },
      )
      request.once("socket", (socket) => {
        let verified = false
        const verifyPinnedAddress = () => {
          if (verified) return
          verified = true
          if (
            !socket.remoteAddress ||
            !sameAddress(socket.remoteAddress, selected.address, selected.family)
          ) {
            request.destroy(new Error("Marketplace TLS socket address did not match the pinned DNS answer"))
          } else {
            resetTimeout()
          }
        }
        socket.once("connect", verifyPinnedAddress)
        socket.once("secureConnect", verifyPinnedAddress)
      })
      resetTimeout = () => {
        clearRequestTimeout()
        timer = setTimeout(() => {
          const error = new Error("Marketplace request timed out")
          fail(error)
          destroyIncoming?.(error)
          request.destroy(error)
        }, timeoutMs)
      }
      resetTimeout()
      request.once("error", fail)
      const onAbort = () => request.destroy(abortError(options.signal?.reason))
      options.signal?.addEventListener("abort", onAbort, { once: true })
      request.once("close", () => options.signal?.removeEventListener("abort", onAbort))
      request.end()
    })
    if (!response.location) return response.body
    if (redirects >= redirectLimit) throw new Error("Marketplace redirect limit was exceeded")
    const redirected = new URL(response.location, url)
    const validated = validatePurposeUrl(redirected.href, purpose, repository, true, options.declaredUrl)
    return this.#fetch(validated.url, purpose, repository, options, redirects + 1)
  }
}

function sameAddress(left: string, right: string, family: 4 | 6): boolean {
  const leftBytes = parseAddressBytes(left, family)
  const rightBytes = parseAddressBytes(right, family)
  return Boolean(
    leftBytes &&
    rightBytes &&
    leftBytes.byteLength === rightBytes.byteLength &&
    leftBytes.every((byte, index) => byte === rightBytes[index]),
  )
}
