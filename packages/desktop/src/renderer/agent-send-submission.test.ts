import { describe, expect, test } from "bun:test"
import {
  AgentSendSubmissionTracker,
  beginAgentSendSubmission,
  endAgentSendSubmission,
  revalidateAgentSendCatalogs,
} from "./agent-send-submission"

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (cause: unknown) => void
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve
    reject = onReject
  })
  return { promise, reject, resolve }
}

describe("Agent send submission feedback", () => {
  test("starts generation and LLM revalidation before either loader settles", async () => {
    const generation = deferred<string>()
    const llm = deferred<string>()
    const calls: string[] = []
    const result = revalidateAgentSendCatalogs({
      loadGeneration: () => {
        calls.push("generation")
        return generation.promise
      },
      loadLlm: () => {
        calls.push("llm")
        return llm.promise
      },
    })

    expect(calls).toEqual(["generation", "llm"])
    generation.resolve("tool")
    llm.resolve("model")
    expect(await result).toEqual({ generation: "tool", llm: "model" })
  })

  test("blocks duplicate submissions synchronously and cleans up only the matching token", () => {
    const tracker = new AgentSendSubmissionTracker()
    const changes: boolean[] = []
    const first = beginAgentSendSubmission(tracker, (value) => changes.push(value))
    expect(first).toBeDefined()
    expect(changes).toEqual([true])
    expect(tracker.submitting).toBe(true)
    expect(beginAgentSendSubmission(tracker, (value) => changes.push(value))).toBeUndefined()
    expect(endAgentSendSubmission(tracker, Symbol("stale"), (value) => changes.push(value))).toBe(false)
    expect(tracker.submitting).toBe(true)
    expect(endAgentSendSubmission(tracker, first!, (value) => changes.push(value))).toBe(true)
    expect(changes).toEqual([true, false])
    expect(tracker.submitting).toBe(false)
  })

  test("settles after loader failure and allows submission cleanup", async () => {
    const tracker = new AgentSendSubmissionTracker()
    const token = tracker.begin()!
    const failure = deferred<string>()
    const request = revalidateAgentSendCatalogs({
      loadGeneration: () => failure.promise,
      loadLlm: async () => "model",
    })
    failure.reject(new Error("catalog failed"))
    await expect(request).rejects.toThrow("catalog failed")
    expect(tracker.end(token)).toBe(true)
    expect(tracker.submitting).toBe(false)
  })
})
