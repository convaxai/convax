import { describe, expect, test } from "bun:test"

import { createElectronPluginConnectedImageInspector } from "./plugin-connected-image-inspector"

describe("Electron Plugin connected-image inspector", () => {
  test("returns decoded dimensions and rejects an empty decode", () => {
    const decoded = createElectronPluginConnectedImageInspector({
      createFromBuffer(bytes) {
        return {
          getSize: () => ({ height: bytes[1] ?? 0, width: bytes[0] ?? 0 }),
          isEmpty: () => bytes.length < 2,
        }
      },
    })

    expect(decoded.inspect(Uint8Array.of(2, 3))).toEqual({ height: 3, width: 2 })
    expect(decoded.inspect(Uint8Array.of(1))).toBeNull()
  })
})
