import { describe, expect, test } from "bun:test"

describe("Canvas file-card assistant sizing", () => {
  test("leaves visual chrome to one wider host-rendered composer surface", async () => {
    const styles = await Bun.file(new URL("./styles.css", import.meta.url)).text()
    const assistantRule = styles.match(/\.convax-canvas \.convax-node-assistant \{[^}]+\}/s)?.[0] ?? ""

    expect(assistantRule).toContain("width: min(720px")
    expect(assistantRule).toContain("height: auto")
    expect(assistantRule).toContain("border: 0")
    expect(assistantRule).toContain("background: transparent")
    expect(assistantRule).toContain("box-shadow: none")
    expect(assistantRule).not.toContain("height: min(380px")
  })
})
