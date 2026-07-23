import { describe, expect, mock, test } from "bun:test"
import { fileURLToPath } from "node:url"

import { webPluginAssetScheme } from "./plugin-asset-protocol"
import { petWindowPartition, registerPetPluginSessionProtocol } from "./pet-session"

describe("pet Plugin Session", () => {
  test("serves Plugin assets with top-level-only CSP on the isolated nonpersistent partition", async () => {
    const handle = mock(
      (_scheme: string, _handler: (request: Request) => Promise<Response>) => undefined,
    )
    const unhandle = mock((_scheme: string) => undefined)
    const fromPartition = mock(() => ({ protocol: { handle, unhandle } }))
    const manager = {
      resolveAsset: mock(async () => fileURLToPath(import.meta.url)),
    }

    const dispose = registerPetPluginSessionProtocol({ fromPartition }, manager)
    expect(fromPartition).toHaveBeenCalledWith(petWindowPartition, { cache: false })
    expect(handle).toHaveBeenCalledTimes(1)
    expect(handle.mock.calls[0]?.[0]).toBe(webPluginAssetScheme)

    const handler = handle.mock.calls[0]?.[1] as (request: Request) => Promise<Response>
    const response = await handler(new Request("convax-plugin://soft-companion/pet/index.html"))
    expect(response.status).toBe(200)
    expect(manager.resolveAsset).toHaveBeenCalledWith("soft-companion", "pet/index.html")
    expect(response.headers.get("content-security-policy")).toContain("frame-ancestors 'none'")

    dispose()
    dispose()
    expect(unhandle).toHaveBeenCalledTimes(1)
    expect(unhandle).toHaveBeenCalledWith(webPluginAssetScheme)
  })
})
