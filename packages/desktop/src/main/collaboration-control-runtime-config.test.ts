import { describe, expect, test } from "bun:test"
import { encodeBase64url } from "@convax/collaboration"
import { parseDesktopCollaborationControlRuntimeConfig } from "./collaboration-control-runtime-config"

describe("Desktop collaboration control runtime configuration", () => {
  test("keeps absence disabled and parses only exact public trust roots", () => {
    expect(parseDesktopCollaborationControlRuntimeConfig(undefined)).toBeNull()
    const value = parseDesktopCollaborationControlRuntimeConfig(JSON.stringify({
      format: "convax.desktop-collaboration-control-runtime/1",
      serviceBaseUrl: "https://control.example",
      trustBundleDigest: "a".repeat(64),
      keys: [{ purpose: "membership", serviceKeyId: "membership-1", publicKey: encodeBase64url(new Uint8Array(32).fill(1)) }],
    }))
    expect(value?.serviceBaseUrl).toBe("https://control.example")
    expect(() => parseDesktopCollaborationControlRuntimeConfig(JSON.stringify({ ...value, extra: true }))).toThrow("unsupported")
  })
})
