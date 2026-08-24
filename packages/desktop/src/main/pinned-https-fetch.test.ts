import https from "node:https"

import { afterEach, describe, expect, test } from "bun:test"

import {
  isPublicMarketplaceAddress,
  marketplaceRepositoryFromDescriptorUrl,
  PinnedHttpsFetcher,
} from "./pinned-https-fetch"

// Keep TLS bytes fixed so the test exercises the fetcher rather than platform
// crypto key generation. Bun 1.3.14 on Windows can panic while generating the
// former RSA fixture before any test begins.
const key = `-----BEGIN PRIVATE KEY-----
MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgeOjkly+Lei/EaMub
UBIcRQ+JTOv5UUhuLbx+BUlgVnmhRANCAATUURNbgndPrh02b8P92Wm8fRUGQQYE
2CKb1JFllBeKlaTwDh4wA2LMP9ZPqefTvr8Da2hEGwLLNVkUHwONlev2
-----END PRIVATE KEY-----`
const cert = `-----BEGIN CERTIFICATE-----
MIIBXDCCAQGgAwIBAgIJAO/XEyqbKw2qMAoGCCqGSM49BAMCMBoxGDAWBgNVBAMM
D293bmVyLmdpdGh1Yi5pbzAeFw0yNjA4MjQxNjUxMDVaFw0zNjA4MjExNjUxMDVa
MBoxGDAWBgNVBAMMD293bmVyLmdpdGh1Yi5pbzBZMBMGByqGSM49AgEGCCqGSM49
AwEHA0IABNRRE1uCd0+uHTZvw/3Zabx9FQZBBgTYIpvUkWWUF4qVpPAOHjADYsw/
1k+p59O+vwNraEQbAss1WRQfA42V6/ajMDAuMCwGA1UdEQQlMCOCD293bmVyLmdp
dGh1Yi5pb4IQbWFya2V0cGxhY2UudGVzdDAKBggqhkjOPQQDAgNJADBGAiEAh1JQ
YQdXvzLtVVlFt9gZ9xgTSSfdH4DqRvCpa3nNY5ICIQDzLRi4tjfJ7GOBM4JhV8Te
gAY5MDm5qgELIH+I6CZk2Q==
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
