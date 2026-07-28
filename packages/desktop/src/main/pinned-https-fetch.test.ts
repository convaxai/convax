import https from "node:https"

import { afterEach, describe, expect, test } from "bun:test"

import {
  isPublicMarketplaceAddress,
  marketplaceRepositoryFromDescriptorUrl,
  PinnedHttpsFetcher,
} from "./pinned-https-fetch"

const key = "TEST_PRIVATE_KEY_REMOVED_FROM_HISTORY"
const cert = `-----BEGIN CERTIFICATE-----
MIIDRjCCAi6gAwIBAgIUQOK+goOJWScFcq4kz4rkDDVNDvMwDQYJKoZIhvcNAQEL
BQAwGzEZMBcGA1UEAwwQbWFya2V0cGxhY2UudGVzdDAeFw0yNjA3MjcxNTIxMjRa
Fw0yNjA3MjkxNTIxMjRaMBsxGTAXBgNVBAMMEG1hcmtldHBsYWNlLnRlc3QwggEi
MA0GCSqGSIb3DQEBAQUAA4IBDwAwggEKAoIBAQDOuS7yvWM+vVFsJ2vXIv5oRoor
BvpYaH35iiaxqWI4OanvgvSDTBg5jbFYHnam7aH7/zVUyAK6zNBxt8f1F5o1hO+y
x6J6UBy4QtaacmILsyUFlhvvJ6VOKAoWFgCqDHcZYRT1a1dbA/Xa82tyayIX/L8w
ll3ozgP2KvBbccEiUTgvRt7GZUA8t8zbRlvOjwehdp5Gny3LWpcvG/sDVHNwFUsv
fLorRR69LpAFkhd3qJ3cU19PJPuDJOKbq6aBpuL2qr4dmq7OU6Y460hI4INSzhxY
3pBC/vjHBg4UeRlcybafZzA0NeSUgLwfK64DKgRs5F/QpoEvQa9mM73PwDJPAgMB
AAGjgYEwfzAdBgNVHQ4EFgQUfjFIpKRft4G+ltZvj61JfVbXUAEwHwYDVR0jBBgw
FoAUfjFIpKRft4G+ltZvj61JfVbXUAEwDwYDVR0TAQH/BAUwAwEB/zAsBgNVHREE
JTAjghBtYXJrZXRwbGFjZS50ZXN0gg9vd25lci5naXRodWIuaW8wDQYJKoZIhvcN
AQELBQADggEBAH9nXIor1R9V8Zl5WCmuHQlYrOMovLW3xWRp/IMIP8IIhhZR3X3g
oc4eztCLB968UW1dVgU1u/kjGbpx/g7tm7nPqVZ2HchOk1DqmzoVA3sfhH72tD7f
AbjmphXfC+m4eLLkpS/97ltxQRc9Npoo5/1m9OKThaPyZHfEAsWVD2/ujUOn1bmk
F4kLKIrLg6D6g0PKa2HYX77SxABVwzkv470vJW3BhxNQmf/H61Z+NA0xegRBIdY2
SSNSesUTGVPPJwZ6JmSa4OUGftSBOa/WhDTDO6v1PbNVN1GQeTgXd6vnwRS/u+Dp
LuvN3MNHDvC2XJdIWM/1bgKXIOYlSfSo230=
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
      },
    })
    expect(
      await fetcher.fetch("https://owner.github.io/repo/marketplace.json", "descriptor", { ca: cert }),
    ).toEqual(Buffer.from('{"schema":"test"}'))
    await expect(
      fetcher.fetch("https://owner.github.io/repo/marketplace.json", "descriptor", { ca: cert, maxBytes: 4 }),
    ).rejects.toThrow("byte limit")
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
