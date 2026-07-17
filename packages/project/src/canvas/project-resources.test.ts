import { describe, expect, test } from "bun:test"
import { isManagedProjectAssetPath } from "./project-resources"

describe("managed Project Canvas assets", () => {
  test("accepts only portable files below the managed asset directory", () => {
    expect(isManagedProjectAssetPath(".convax/assets/panorama.jpg")).toBe(true)
    expect(isManagedProjectAssetPath(".convax/assets/references/atrium.webp")).toBe(true)

    for (const path of [
      ".convax/assets",
      ".convax/assets/",
      ".convax/assets/../project.json",
      ".convax/assets//panorama.jpg",
      ".convax/assets/references/.convax/secret.jpg",
      ".convax/assets/references/.CONVAX/secret.jpg",
      ".convax/assets/CON.jpg",
      ".convax/assets/panorama.jpg ",
      ".convax/canvases/private.png",
      "docs/secret.jpg",
      "C:/secret.jpg",
      "\\\\server\\secret.jpg",
    ]) {
      expect(isManagedProjectAssetPath(path)).toBe(false)
    }
  })
})
