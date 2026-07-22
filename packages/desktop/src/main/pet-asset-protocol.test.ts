import { describe, expect, mock, test } from "bun:test"

import { createPetAssetHandler, petAssetIdForUrl } from "./pet-asset-protocol"

describe("pet asset protocol", () => {
  test("accepts one canonical opaque pet id and rejects ambiguous URLs", () => {
    expect(petAssetIdForUrl("convax-pet-asset://pet/plugin%3Aconvax-pet-violet")).toBe("plugin:convax-pet-violet")
    expect(petAssetIdForUrl("convax-pet-asset://pet/custom%3AMochi_1")).toBe("custom:Mochi_1")
    expect(petAssetIdForUrl("convax-pet-asset://other/plugin%3Aconvax-pet-violet")).toBeNull()
    expect(petAssetIdForUrl("convax-pet-asset://pet/custom%3A..%2Fsecret")).toBeNull()
    expect(petAssetIdForUrl("convax-pet-asset://pet/custom%3AMochi?path=/private/secret")).toBeNull()
  })

  test("resolves through the controller and returns a generic miss", async () => {
    const resolvePetAsset = mock(async () => "/managed/pets/violet.webp")
    const fetchFile = mock(async () => new Response("image", { status: 200 }))
    const handler = createPetAssetHandler({ resolvePetAsset }, fetchFile)
    const request = new Request("convax-pet-asset://pet/plugin%3Aconvax-pet-violet", {
      headers: { accept: "image/webp" },
    })

    expect((await handler(request)).status).toBe(200)
    expect(resolvePetAsset).toHaveBeenCalledWith("plugin:convax-pet-violet")
    expect(fetchFile).toHaveBeenCalledWith("file:///managed/pets/violet.webp", { headers: request.headers })

    resolvePetAsset.mockRejectedValueOnce(new Error("/private/secret source"))
    const missing = await handler(new Request("convax-pet-asset://pet/custom%3Amissing"))
    expect(missing.status).toBe(404)
    expect(await missing.text()).not.toContain("/private/")
  })
})
