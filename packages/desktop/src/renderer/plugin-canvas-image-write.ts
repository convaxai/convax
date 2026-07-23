import type { CanvasDocument } from "@convax/canvas"

export interface PluginCanvasImageWriteScope {
  canvasId: string
  projectId: string
  signal: AbortSignal
}

export interface PluginCanvasImageWritePorts {
  assertCurrentScope(projectId: string, canvasId: string): void
  flushAuthoritativeCanvas(): Promise<CanvasDocument | undefined>
}

export interface PluginCanvasImageWriteExecutionPorts<Result> extends PluginCanvasImageWritePorts {
  cancel(): void
  write(document: CanvasDocument): Promise<Result>
}

function throwIfAborted(signal: AbortSignal) {
  if (!signal.aborted) return
  if (signal.reason instanceof Error) throw signal.reason
  throw new DOMException("Plugin Canvas image write was canceled", "AbortError")
}

/**
 * Waits for optimistic renderer edits to reach Main and returns the revision that
 * the authoritative image transaction must guard.
 */
export async function preparePluginCanvasImageWrite(
  input: PluginCanvasImageWriteScope,
  ports: PluginCanvasImageWritePorts,
) {
  throwIfAborted(input.signal)
  ports.assertCurrentScope(input.projectId, input.canvasId)
  const document = await ports.flushAuthoritativeCanvas()
  throwIfAborted(input.signal)
  ports.assertCurrentScope(input.projectId, input.canvasId)
  if (!document || document.id !== input.canvasId) {
    throw new Error("Plugin Canvas image write could not resolve Main's authoritative document")
  }
  return document
}

/**
 * Bridges cancellation only after the renderer state barrier, then closes the
 * final microtask gap with one last scope and abort check before invoking Main.
 */
export async function executePluginCanvasImageWrite<Result>(
  input: PluginCanvasImageWriteScope,
  ports: PluginCanvasImageWriteExecutionPorts<Result>,
) {
  const document = await preparePluginCanvasImageWrite(input, ports)
  const cancel = () => ports.cancel()
  input.signal.addEventListener("abort", cancel, { once: true })
  try {
    throwIfAborted(input.signal)
    ports.assertCurrentScope(input.projectId, input.canvasId)
    const result = await ports.write(document)
    throwIfAborted(input.signal)
    ports.assertCurrentScope(input.projectId, input.canvasId)
    return result
  } finally {
    input.signal.removeEventListener("abort", cancel)
  }
}
