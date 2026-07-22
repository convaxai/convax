import { describe, expect, mock, test } from "bun:test"

import { petWindowPartition, registerPetAssetSessionProtocol } from "./pet-session"

describe("pet asset Session", () => {
  test("registers and removes the asset handler on the isolated pet partition", () => {
    const handle = mock(() => undefined)
    const unhandle = mock(() => undefined)
    const fromPartition = mock(() => ({ protocol: { handle, unhandle } }))
    const handler = async () => new Response()

    const dispose = registerPetAssetSessionProtocol({ fromPartition }, handler)
    expect(fromPartition).toHaveBeenCalledWith(petWindowPartition, { cache: false })
    expect(handle).toHaveBeenCalledWith("convax-pet-asset", handler)
    dispose()
    expect(unhandle).toHaveBeenCalledWith("convax-pet-asset")
  })
})
