import { generateKeyPairSync, randomBytes, sign } from "node:crypto"
import https from "node:https"

import { afterEach, describe, expect, test } from "bun:test"

import {
  isPublicMarketplaceAddress,
  marketplaceRepositoryFromDescriptorUrl,
  PinnedHttpsFetcher,
} from "./pinned-https-fetch"

const encodeDerLength = (length: number): Buffer => {
  if (length < 0x80) return Buffer.from([length])
  const bytes: number[] = []
  for (let remaining = length; remaining > 0; remaining >>>= 8) bytes.unshift(remaining & 0xff)
  return Buffer.from([0x80 | bytes.length, ...bytes])
}

const encodeDer = (tag: number, ...parts: Buffer[]): Buffer => {
  const value = Buffer.concat(parts)
  return Buffer.concat([Buffer.from([tag]), encodeDerLength(value.length), value])
}

const encodeDerOid = (...arcs: number[]): Buffer => {
  const bytes: number[] = []
  for (const arc of [arcs[0] * 40 + arcs[1], ...arcs.slice(2)]) {
    const encoded = [arc & 0x7f]
    for (let remaining = arc >>> 7; remaining > 0; remaining >>>= 7) {
      encoded.unshift((remaining & 0x7f) | 0x80)
    }
    bytes.push(...encoded)
  }
  return encodeDer(0x06, Buffer.from(bytes))
}

const encodeUtcTime = (date: Date): Buffer => {
  const value = [
    String(date.getUTCFullYear()).slice(-2),
    String(date.getUTCMonth() + 1).padStart(2, "0"),
    String(date.getUTCDate()).padStart(2, "0"),
    String(date.getUTCHours()).padStart(2, "0"),
    String(date.getUTCMinutes()).padStart(2, "0"),
    String(date.getUTCSeconds()).padStart(2, "0"),
  ].join("")
  return encodeDer(0x17, Buffer.from(`${value}Z`, "ascii"))
}

const encodeName = (commonName: string): Buffer =>
  encodeDer(0x30, encodeDer(0x31, encodeDer(0x30, encodeDerOid(2, 5, 4, 3), encodeDer(0x0c, Buffer.from(commonName)))))

const encodePem = (label: string, value: Buffer): string => {
  const lines = value.toString("base64").match(/.{1,64}/g)
  if (!lines) throw new Error(`Could not encode ${label}`)
  return [`-----BEGIN ${label}-----`, ...lines, `-----END ${label}-----`].join("\n")
}

const createTlsFixture = (): { cert: string; key: string } => {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 })
  const signatureAlgorithm = encodeDer(0x30, encodeDerOid(1, 2, 840, 113549, 1, 1, 11), encodeDer(0x05))
  const certificateName = encodeName("marketplace.test")
  const now = Date.now()
  const serial = randomBytes(16)
  const serialNumber = serial[0] & 0x80 ? Buffer.concat([Buffer.from([0]), serial]) : serial
  const subjectAltName = encodeDer(
    0x30,
    encodeDerOid(2, 5, 29, 17),
    encodeDer(
      0x04,
      encodeDer(
        0x30,
        encodeDer(0x82, Buffer.from("marketplace.test", "ascii")),
        encodeDer(0x82, Buffer.from("owner.github.io", "ascii")),
      ),
    ),
  )
  const tbsCertificate = encodeDer(
    0x30,
    encodeDer(0xa0, encodeDer(0x02, Buffer.from([2]))),
    encodeDer(0x02, serialNumber),
    signatureAlgorithm,
    certificateName,
    encodeDer(0x30, encodeUtcTime(new Date(now - 60_000)), encodeUtcTime(new Date(now + 24 * 60 * 60 * 1_000))),
    certificateName,
    Buffer.from(publicKey.export({ type: "spki", format: "der" })),
    encodeDer(0xa3, encodeDer(0x30, subjectAltName)),
  )
  const certificate = encodeDer(
    0x30,
    tbsCertificate,
    signatureAlgorithm,
    encodeDer(0x03, Buffer.concat([Buffer.from([0]), sign("sha256", tbsCertificate, privateKey)])),
  )
  return {
    cert: encodePem("CERTIFICATE", certificate),
    key: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  }
}

const { cert, key } = createTlsFixture()

const servers: https.Server[] = []
afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.closeAllConnections()
          server.close(() => resolve())
        }),
    ),
  )
})

describe("PinnedHttpsFetcher", () => {
  test("rejects private, mapped, link-local, multicast and mixed DNS answers", async () => {
    expect(isPublicMarketplaceAddress("8.8.8.8", 4)).toBe(true)
    expect(isPublicMarketplaceAddress("20.27.177.113", 4)).toBe(true)
    expect(isPublicMarketplaceAddress("185.199.108.133", 4)).toBe(true)
    expect(isPublicMarketplaceAddress("2606:50c0:8000::154", 6)).toBe(true)
    for (const address of ["127.0.0.1", "10.0.0.1", "169.254.169.254", "224.0.0.1"]) {
      expect(isPublicMarketplaceAddress(address, 4)).toBe(false)
    }
    expect(isPublicMarketplaceAddress("192.88.99.1", 4)).toBe(false)
    for (const address of ["::1", "::ffff:127.0.0.1", "64:ff9b:1::1", "2002::1", "fe80::1", "ff02::1"]) {
      expect(isPublicMarketplaceAddress(address, 6)).toBe(false)
    }
    expect(isPublicMarketplaceAddress("fec0::1", 6)).toBe(false)
    const fetcher = new PinnedHttpsFetcher({
      testing: {
        resolve: (async () => [
          { address: "8.8.8.8", family: 4 },
          { address: "127.0.0.1", family: 4 },
        ]) as never,
      },
    })
    await expect(fetcher.fetch("https://owner.github.io/repo/marketplace.json", "descriptor")).rejects.toThrow(
      "non-public",
    )
  })

  test("binds the real TLS socket to the reviewed DNS answer and enforces response limits", async () => {
    const server = https.createServer({ cert, key }, (_request, response) => {
      response.setHeader("content-type", "application/json")
      response.end('{"schema":"test"}')
    })
    servers.push(server)
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
    const address = server.address()
    if (!address || typeof address === "string") throw new Error("TLS fixture did not bind")
    let receivedCustomCa = false
    let receivedUrlServername = false
    const fetcher = new PinnedHttpsFetcher({
      testing: {
        connectPort: address.port,
        isPublicAddress: (candidate) => candidate === "127.0.0.1",
        request: (options, onResponse) => {
          receivedCustomCa = "ca" in options
          receivedUrlServername = options.servername === "owner.github.io"
          return https.request({ ...options, ca: cert, servername: "owner.github.io" }, onResponse)
        },
        resolve: (async () => [{ address: "127.0.0.1", family: 4 }]) as never,
      },
    })
    expect(await fetcher.fetch("https://owner.github.io/repo/marketplace.json", "descriptor")).toEqual(
      Buffer.from('{"schema":"test"}'),
    )
    expect(receivedCustomCa).toBe(false)
    expect(receivedUrlServername).toBe(true)
    await expect(
      fetcher.fetch("https://owner.github.io/repo/marketplace.json", "descriptor", { maxBytes: 4 }),
    ).rejects.toThrow("byte limit")
  })

  test("treats the request timeout as an inactivity limit for streamed release bytes", async () => {
    const server = https.createServer({ cert, key }, (_request, response) => {
      response.write("a")
      setTimeout(() => response.write("b"), 300)
      setTimeout(() => response.end("c"), 600)
    })
    servers.push(server)
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
    const address = server.address()
    if (!address || typeof address === "string") throw new Error("TLS fixture did not bind")
    const fetcher = new PinnedHttpsFetcher({
      testing: {
        connectPort: address.port,
        isPublicAddress: (candidate) => candidate === "127.0.0.1",
        request: (options, onResponse) =>
          https.request({ ...options, ca: cert, servername: "owner.github.io" }, onResponse),
        resolve: (async () => [{ address: "127.0.0.1", family: 4 }]) as never,
      },
    })

    expect(
      await fetcher.fetch("https://github.com/owner/repo/releases/download/v1.0.0/plugin.zip", "release", {
        repository: { owner: "owner", repository: "repo" },
        timeoutMs: 500,
      }),
    ).toEqual(Buffer.from("abc"))
  })

  test("still rejects a release response that stops making progress", async () => {
    const server = https.createServer({ cert, key }, (_request, response) => {
      response.write("a")
      setTimeout(() => response.end("b"), 500)
    })
    servers.push(server)
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
    const address = server.address()
    if (!address || typeof address === "string") throw new Error("TLS fixture did not bind")
    const fetcher = new PinnedHttpsFetcher({
      testing: {
        connectPort: address.port,
        isPublicAddress: (candidate) => candidate === "127.0.0.1",
        request: (options, onResponse) =>
          https.request({ ...options, ca: cert, servername: "owner.github.io" }, onResponse),
        resolve: (async () => [{ address: "127.0.0.1", family: 4 }]) as never,
      },
    })

    await expect(
      fetcher.fetch("https://github.com/owner/repo/releases/download/v1.0.0/plugin.zip", "release", {
        repository: { owner: "owner", repository: "repo" },
        timeoutMs: 50,
      }),
    ).rejects.toThrow("timed out")
  })

  test("admits only exact GitHub Pages descriptor ownership", () => {
    expect(marketplaceRepositoryFromDescriptorUrl("https://owner.github.io/repo/marketplace.json")).toEqual({
      owner: "owner",
      repository: "repo",
    })
    for (const value of [
      "https://example.com/repo/marketplace.json",
      "https://owner.github.io/other/path.json",
      "https://owner.github.io/repo/marketplace.json?token=secret",
    ]) {
      expect(() => marketplaceRepositoryFromDescriptorUrl(value)).toThrow()
    }
  })

  test("revalidates a constrained GitHub Release CDN redirect and rejects its mixed/private DNS", async () => {
    const server = https.createServer({ cert, key }, (_request, response) => {
      response.writeHead(302, {
        location: "https://release-assets.githubusercontent.com/github-production-release-asset/1/file?sig=x",
      })
      response.end()
    })
    servers.push(server)
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
    const address = server.address()
    if (!address || typeof address === "string") throw new Error("TLS fixture did not bind")
    const fetcher = new PinnedHttpsFetcher({
      testing: {
        connectPort: address.port,
        isPublicAddress: (candidate) => candidate === "127.0.0.1",
        request: (options, onResponse) =>
          https.request({ ...options, ca: cert, servername: "owner.github.io" }, onResponse),
        resolve: (async (hostname: string) =>
          hostname === "github.com"
            ? [{ address: "127.0.0.1", family: 4 }]
            : [
                { address: "127.0.0.1", family: 4 },
                { address: "10.0.0.1", family: 4 },
              ]) as never,
      },
    })
    await expect(
      fetcher.fetch("https://github.com/owner/repo/releases/download/v1.0.0/plugin.zip", "release", {
        repository: { owner: "owner", repository: "repo" },
      }),
    ).rejects.toThrow("non-public")
    await expect(
      fetcher.fetch("https://github.com/other/repo/releases/download/v1.0.0/plugin.zip", "release", {
        repository: { owner: "owner", repository: "repo" },
      }),
    ).rejects.toThrow("does not match")
  })
})
