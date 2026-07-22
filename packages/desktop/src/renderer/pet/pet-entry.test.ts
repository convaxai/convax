import { describe, expect, test } from "bun:test"

describe("pet renderer entry", () => {
  test("declares every hook before the empty-snapshot return", async () => {
    const source = await Bun.file(new URL("./index.tsx", import.meta.url)).text()
    const emptySnapshotReturn = source.indexOf("if (!snapshot) return null")
    expect(emptySnapshotReturn).toBeGreaterThan(0)
    for (const hook of ["useState(", "useEffect(", "useMemo<"]) {
      expect(source.lastIndexOf(hook)).toBeLessThan(emptySnapshotReturn)
    }
  })
})
