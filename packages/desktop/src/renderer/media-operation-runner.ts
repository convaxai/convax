import type {
  GenerationCanvasAdmissionRequest,
  GenerationCanvasAdmissionResult,
  GenerationCanvasRequest,
  GenerationCanvasResult,
} from "../generation-contracts"

export async function runMediaOperationAdmission(options: {
  admit: (request: GenerationCanvasAdmissionRequest) => Promise<GenerationCanvasAdmissionResult>
  cancel: (request: { operationId: string }) => Promise<void>
  request: GenerationCanvasAdmissionRequest
  signal: AbortSignal
}): Promise<GenerationCanvasAdmissionResult> {
  throwIfAborted(options.signal)
  const operationId = options.request.steps[0]?.request.operationId
  if (!operationId) throw new Error("Media operation admission requires at least one generation step")
  const cancelPendingAdmission = () => {
    void options.cancel({ operationId }).catch(() => undefined)
  }
  options.signal.addEventListener("abort", cancelPendingAdmission, { once: true })
  try {
    return await options.admit(options.request)
  } finally {
    options.signal.removeEventListener("abort", cancelPendingAdmission)
  }
}

export async function runMediaOperationReturn(options: {
  cancel: (request: { operationId: string }) => Promise<void>
  generate: (request: GenerationCanvasRequest) => Promise<GenerationCanvasResult>
  request: GenerationCanvasRequest
  signal: AbortSignal
}): Promise<{ outputText: string; warnings: readonly string[] }> {
  throwIfAborted(options.signal)
  const cancel = () => {
    void options.cancel({ operationId: options.request.operationId }).catch(() => undefined)
  }
  options.signal.addEventListener("abort", cancel, { once: true })
  try {
    const result = await options.generate(options.request)
    throwIfAborted(options.signal)
    if (result.createdNodeIds.length !== 0 || typeof result.outputText !== "string" || result.outputText.length === 0) {
      throw new Error("Return-delivery media operation did not produce one bounded text result")
    }
    return { outputText: result.outputText, warnings: result.warnings }
  } finally {
    options.signal.removeEventListener("abort", cancel)
  }
}

function throwIfAborted(signal: AbortSignal) {
  if (signal.aborted) throw signal.reason ?? new DOMException("Canceled", "AbortError")
}
