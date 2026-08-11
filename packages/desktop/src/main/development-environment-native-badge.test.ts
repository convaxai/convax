import { describe, expect, test } from "bun:test"
import { createDevelopmentEnvironmentNativeBadge } from "./development-environment-native-badge"

describe("development environment native badge", () => {
  test("creates a bounded BGRA overlay that varies by task identity", () => {
    const first = createDevelopmentEnvironmentNativeBadge({ id: "abc123", label: "test-env" })
    const second = createDevelopmentEnvironmentNativeBadge({ id: "def456", label: "test-env" })

    expect(first.width).toBe(32)
    expect(first.height).toBe(32)
    expect(first.bitmap).toHaveLength(32 * 32 * 4)
    expect(first.bitmap.some((value, index) => index % 4 === 3 && value === 255)).toBe(true)
    expect(first.bitmap.equals(second.bitmap)).toBe(false)
  })
})
