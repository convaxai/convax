import { describe, expect, test } from "bun:test"

import {
  prepareAgentResourceParts,
  withConvaxPrivateStoragePermissions,
} from "../src/node/opencode-agent-runtime"

describe("Convax OpenCode boundaries", () => {
  test("merges private-storage denies with caller permissions without mutation", () => {
    const config = {
      model: "provider/model",
      permission: {
        bash: "ask" as const,
        edit: "allow" as const,
        read: { "*": "ask" as const, ".convax/**": "allow" as const },
      },
    }

    const merged = withConvaxPrivateStoragePermissions(config)

    expect(merged).not.toBe(config)
    expect(merged.model).toBe("provider/model")
    expect(config.permission.read[".convax/**"]).toBe("allow")
    expect(merged.permission).toMatchObject({ bash: "ask" })
    expect(typeof merged.permission).toBe("object")
    if (typeof merged.permission !== "object") throw new Error("Expected permission object")
    expect(merged.permission.read).toMatchObject({ "*": "ask", ".convax/**": "deny", "**/.convax/**": "deny" })
    expect(merged.permission.edit).toMatchObject({ "*": "allow", ".convax/**": "deny", "**/.convax/**": "deny" })
  })

  test("preserves a global permission fallback while protecting Canvas storage", () => {
    const merged = withConvaxPrivateStoragePermissions({ permission: "ask" })
    if (typeof merged.permission !== "object") throw new Error("Expected permission object")
    expect(merged.permission["*"]).toBe("ask")
    expect(merged.permission.read).toMatchObject({ "*": "ask", ".convax/**": "deny" })
    expect(merged.permission.edit).toMatchObject({ "*": "ask", ".convax/**": "deny" })
  })

  test("creates a pathless data attachment from a prepared Canvas snapshot", async () => {
    const content = JSON.stringify({ id: "canvas-1", nodes: [] })
    const [part] = await prepareAgentResourceParts("/directory/that/does/not/exist", [{
      canvasId: "canvas-1",
      content,
      kind: "canvas",
      mime: "application/json",
      name: "Blank",
    }])

    expect(part?.filename).toBe("Blank.canvas.json")
    expect(part?.mime).toBe("application/json")
    expect(part?.source).toBeUndefined()
    expect(part?.url.startsWith("data:application/json;base64,")).toBe(true)
    expect(Buffer.from(part!.url.split(",")[1]!, "base64").toString("utf8")).toBe(content)
  })
})
