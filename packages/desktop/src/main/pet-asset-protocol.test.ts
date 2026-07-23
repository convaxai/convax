import { describe, expect, mock, test } from "bun:test"

import { createPetAssetHandler, petAssetIdForUrl } from "./pet-asset-protocol"

describe("custom pet asset protocol", () => {
  test("accepts one canonical opaque custom id and rejects ambiguous URLs", () => {
    expect(petAssetIdForUrl("convax-pet-asset://pet/custom-pet-one")).toBe("custom-pet-one")
    expect(petAssetIdForUrl("convax-pet-asset://other/custom-pet-one")).toBeNull()
    expect(petAssetIdForUrl("convax-pet-asset://pet/custom-..%2Fsecret")).toBeNull()
    expect(petAssetIdForUrl("convax-pet-asset://pet/custom-pet-one?path=/private/secret")).toBeNull()
    expect(petAssetIdForUrl("convax-pet-asset://pet/violet")).toBeNull()
  })

  test("resolves through managed storage and returns a generic miss", async () => {
    const resolveAsset = mock(async () => "/managed/pets/custom-pet-one/spritesheet.webp")
    const fetchFile = mock(async () => new Response("image", { status: 200 }))
    const handler = createPetAssetHandler({ resolveAsset }, fetchFile)
    const request = new Request("convax-pet-asset://pet/custom-pet-one", {
      headers: { accept: "image/webp" },
    })

    expect((await handler(request)).status).toBe(200)
    expect(resolveAsset).toHaveBeenCalledWith("custom-pet-one")
    expect(fetchFile).toHaveBeenCalledWith("file:///managed/pets/custom-pet-one/spritesheet.webp", {
      headers: request.headers,
    })

    resolveAsset.mockRejectedValueOnce(new Error("/private/secret source"))
    const missing = await handler(new Request("convax-pet-asset://pet/custom-missing"))
    expect(missing.status).toBe(404)
    expect(await missing.text()).not.toContain("/private/")
  })
})
