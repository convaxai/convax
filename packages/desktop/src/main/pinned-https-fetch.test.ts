import https from "node:https"

import { afterEach, describe, expect, test } from "bun:test"

import {
  isPublicMarketplaceAddress,
  marketplaceRepositoryFromDescriptorUrl,
  PinnedHttpsFetcher,
} from "./pinned-https-fetch"

const key = "TEST_PRIVATE_KEY_REMOVED_FROM_HISTORY"
const cert = `-----BEGIN CERTIFICATE-----
MIIC6TCCAdGgAwIBAgIJAJIEGZUb/KDuMA0GCSqGSIb3DQEBCwUAMBsxGTAXBgNV
BAMMEG1hcmtldHBsYWNlLnRlc3QwHhcNMjYwNzMwMDcxMDU2WhcNMzYwNzI3MDcx
MDU2WjAbMRkwFwYDVQQDDBBtYXJrZXRwbGFjZS50ZXN0MIIBIjANBgkqhkiG9w0B
AQEFAAOCAQ8AMIIBCgKCAQEA6gJ0wfxWo5GSo5ID7/y2eYM55TwS5AceSntaMRYD
VmCorK3Fg7viXPKzQ78BcsHguSDI0d+Fl0mkaQT+uwDQKZs7iqjCbXjeGrou7cPo
EuNjCyODmx+CUsIYWOVZOMEu12ngZT8dpqSbYf4Qob6TmsZ+eKgt1nkQ+hpnzwOV
EEAaXjgAq28+jO53/Fu5t5+UEpyTXh7tDdJms00EZgGIyKKNioWuKC+lJdtocDqO
VCNH/DMPwOEv3/i+uC8iBuniI1mGDjzFeNF8t2TgxQCd4kVlIXT3Nv7ebKwcDTrw
2VQjV5bkbx0z7MGaVy10WBEurA1u7TwNTfRZDjv1MB7UaQIDAQABozAwLjAsBgNV
HREEJTAjghBtYXJrZXRwbGFjZS50ZXN0gg9vd25lci5naXRodWIuaW8wDQYJKoZI
hvcNAQELBQADggEBABhIyvpFdH02+impR3c81TwEMF6mAfP9lKfgzUrEm/wnIEGB
uhAn2CoXHO6NZRVJCSi7Vq6EJBakD/Lc67o9UHNj3xueMAJTQDhbZ6CabTGt77tX
+L2yRRHsVIigfLJlBe+HbndPY2O3gbcpXB4CoOV4gNi1I+GfGIrxAr7/WqYFd3dy
nmQP0B25TOehw0Thbe5hHbVRdsIKdvk09JemOmnrkMuo3JboFkPADXysp5czokr7
dcFbIQHckmslms/qV1NGfM34fg8zY9dwtz+MjzGJsTLA0LEXiXCzb0o2xwjGb0FJ
QR528HAtGXTdbNYImBQa8DOWe83SvYXyo0ner6A=
-----END CERTIFICATE-----`

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
    for (const address of [
      "::1",
      "::ffff:127.0.0.1",
      "64:ff9b:1::1",
      "2002::1",
      "fe80::1",
      "ff02::1",
    ]) {
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
    const fetcher = new PinnedHttpsFetcher({
      testing: {
        connectPort: address.port,
        isPublicAddress: (candidate) => candidate === "127.0.0.1",
        resolve: (async () => [{ address: "127.0.0.1", family: 4 }]) as never,
        tlsServername: "owner.github.io",
      },
    })
    expect(
      await fetcher.fetch("https://owner.github.io/repo/marketplace.json", "descriptor", { ca: cert }),
    ).toEqual(Buffer.from('{"schema":"test"}'))
    await expect(
      fetcher.fetch("https://owner.github.io/repo/marketplace.json", "descriptor", { ca: cert, maxBytes: 4 }),
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
        resolve: (async () => [{ address: "127.0.0.1", family: 4 }]) as never,
        tlsServername: "owner.github.io",
      },
    })

    expect(
      await fetcher.fetch(
        "https://github.com/owner/repo/releases/download/v1.0.0/plugin.zip",
        "release",
        {
          ca: cert,
          repository: { owner: "owner", repository: "repo" },
          timeoutMs: 500,
        },
      ),
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
        resolve: (async () => [{ address: "127.0.0.1", family: 4 }]) as never,
        tlsServername: "owner.github.io",
      },
    })

    await expect(
      fetcher.fetch(
        "https://github.com/owner/repo/releases/download/v1.0.0/plugin.zip",
        "release",
        {
          ca: cert,
          repository: { owner: "owner", repository: "repo" },
          timeoutMs: 50,
        },
      ),
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
        resolve: (async (hostname: string) =>
          hostname === "github.com"
            ? [{ address: "127.0.0.1", family: 4 }]
            : [
                { address: "127.0.0.1", family: 4 },
                { address: "10.0.0.1", family: 4 },
              ]) as never,
        tlsServername: "owner.github.io",
      },
    })
    await expect(
      fetcher.fetch("https://github.com/owner/repo/releases/download/v1.0.0/plugin.zip", "release", {
        ca: cert,
        repository: { owner: "owner", repository: "repo" },
      }),
    ).rejects.toThrow("non-public")
    await expect(
      fetcher.fetch("https://github.com/other/repo/releases/download/v1.0.0/plugin.zip", "release", {
        ca: cert,
        repository: { owner: "owner", repository: "repo" },
      }),
    ).rejects.toThrow("does not match")
  })
})
