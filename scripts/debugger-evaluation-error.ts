const transientDebuggerEvaluationMessages = [
  "Execution context was destroyed",
  "Inspected target navigated or closed",
  "Promise was collected",
] as const

export function isTransientDebuggerEvaluationError(value: unknown) {
  const message = String(value)
  return transientDebuggerEvaluationMessages.some((candidate) => message.includes(candidate))
}
