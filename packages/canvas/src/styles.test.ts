import { describe, expect, test } from "bun:test"

describe("Canvas file-card assistant sizing", () => {
  test("uses a wider content-sized surface instead of forcing the old tall dialog", async () => {
    const styles = await Bun.file(new URL("./styles.css", import.meta.url)).text()
    const assistantRule = styles.match(/\.convax-canvas \.convax-node-assistant \{[^}]+\}/s)?.[0] ?? ""

    expect(assistantRule).toContain("width: min(480px")
    expect(assistantRule).toContain("height: auto")
    expect(assistantRule).not.toContain("height: min(380px")
  })
})
