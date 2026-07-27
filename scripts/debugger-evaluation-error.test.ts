import { describe, expect, test } from "bun:test"
import { isTransientDebuggerEvaluationError } from "./debugger-evaluation-error"

describe("isTransientDebuggerEvaluationError", () => {
  test.each([
    "Execution context was destroyed",
    "Inspected target navigated or closed",
    "Promise was collected",
  ])("recognizes reload-boundary error: %s", (message) => {
    expect(isTransientDebuggerEvaluationError(new Error(message))).toBe(true)
  })

  test("does not hide an application evaluation failure", () => {
    expect(isTransientDebuggerEvaluationError(new Error("Canvas assertion failed"))).toBe(false)
  })
})
