import { describe, expect, test } from "bun:test"
import {
  agentGenerationPreferenceStorageKey,
  readAgentGenerationPreference,
  writeAgentGenerationPreference,
} from "./agent-generation-preference"

describe("Agent generation preference", () => {
  test("round trips one user-global model default", () => {
    let stored = ""
    expect(
      writeAgentGenerationPreference(
        {
          setItem(key, value) {
            expect(key).toBe(agentGenerationPreferenceStorageKey)
            stored = value
          },
        },
        { id: "plugin.example:image.generate", output: "image" },
      ),
    ).toBeTrue()
    expect(readAgentGenerationPreference({ getItem: () => stored })).toEqual({
      id: "plugin.example:image.generate",
      output: "image",
    })
  })

  test("clears to Auto and fails closed on malformed storage", () => {
    let stored = ""
    writeAgentGenerationPreference({ setItem: (_key, value) => (stored = value) })
    expect(readAgentGenerationPreference({ getItem: () => stored })).toBeUndefined()
    expect(readAgentGenerationPreference({ getItem: () => "not-json" })).toBeUndefined()
    expect(
      readAgentGenerationPreference({
        getItem: () => JSON.stringify({ output: "image", toolId: " bad ", version: 1 }),
      }),
    ).toBeUndefined()
    expect(
      readAgentGenerationPreference({
        getItem: () => JSON.stringify({ output: "text", toolId: "tool", version: 1 }),
      }),
    ).toBeUndefined()
  })

  test("does not fail when browser preference storage is unavailable", () => {
    expect(
      writeAgentGenerationPreference({
        setItem() {
          throw new Error("unavailable")
        },
      }),
    ).toBeFalse()
  })
})
