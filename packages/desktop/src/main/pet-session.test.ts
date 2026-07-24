import { describe, expect, mock, test } from "bun:test"
import { fileURLToPath } from "node:url"

import { webPluginAssetScheme } from "./plugin-asset-protocol"
import { petAssetScheme } from "./pet-asset-protocol"
import { petWindowPartition, registerPetPluginSessionProtocol } from "./pet-session"

describe("pet Plugin Session", () => {
  test("serves Plugin assets with top-level-only CSP on the isolated nonpersistent partition", async () => {
    const handle = mock((_scheme: string, _handler: (request: Request) => Promise<Response>) => undefined)
    const unhandle = mock((_scheme: string) => undefined)
    const fromPartition = mock(() => ({ protocol: { handle, unhandle } }))
    const manager = {
      resolveAsset: mock(async () => fileURLToPath(import.meta.url)),
    }
    const customPets = {
      resolveAsset: mock(async () => fileURLToPath(import.meta.url)),
    }
    const fetchFile = mock(async () => new Response("pet", { status: 200 }))

    const dispose = registerPetPluginSessionProtocol({ fromPartition }, manager, customPets, fetchFile)
    expect(fromPartition).toHaveBeenCalledWith(petWindowPartition, { cache: false })
    expect(handle).toHaveBeenCalledTimes(2)
    expect(handle.mock.calls[0]?.[0]).toBe(webPluginAssetScheme)
    expect(handle.mock.calls[1]?.[0]).toBe(petAssetScheme)

    const handler = handle.mock.calls[0]?.[1] as (request: Request) => Promise<Response>
    const response = await handler(new Request("convax-plugin://soft-companion/pet/index.html"))
    expect(response.status).toBe(200)
    expect(manager.resolveAsset).toHaveBeenCalledWith("soft-companion", "pet/index.html")
    expect(response.headers.get("content-security-policy")).toContain("frame-ancestors 'none'")

    const assetHandler = handle.mock.calls[1]?.[1] as (request: Request) => Promise<Response>
    expect((await assetHandler(new Request("convax-pet-asset://pet/custom-nova"))).status).toBe(200)
    expect(customPets.resolveAsset).toHaveBeenCalledWith("custom-nova")

    dispose()
    dispose()
    expect(unhandle).toHaveBeenCalledTimes(2)
    expect(unhandle).toHaveBeenCalledWith(webPluginAssetScheme)
    expect(unhandle).toHaveBeenCalledWith(petAssetScheme)
  })
})
