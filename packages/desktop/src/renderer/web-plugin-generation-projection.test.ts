import { describe, expect, mock, test } from "bun:test"
import type { PluginNodeInvocationRef } from "../plugin-host-types"
import { WebPluginGenerationProjectionCoordinator } from "./web-plugin-generation-projection"

const ref: PluginNodeInvocationRef = {
  canvasId: "canvas-1",
  nodeId: "node-1",
  pluginId: "multi-angle",
  projectId: "project-1",
}

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

describe("WebPluginGenerationProjectionCoordinator", () => {
  test("returns the domain result without waiting for renderer projection", async () => {
    const coordinator = new WebPluginGenerationProjectionCoordinator()
    const projection = deferred()
    const reloadAuthoritative = mock(() => projection.promise)

    await expect(coordinator.execute(ref, async () => ({ revision: 7 }), reloadAuthoritative)).resolves.toEqual({
      revision: 7,
    })
    expect(reloadAuthoritative).toHaveBeenCalledTimes(1)

    let settled = false
    const waiting = coordinator
      .wait({ ...ref, nodeId: "node-2", pluginId: "another-plugin" }, new AbortController().signal)
      .then(() => {
        settled = true
      })
    await Promise.resolve()
    expect(settled).toBeFalse()

    projection.resolve()
    await waiting
    expect(settled).toBeTrue()
  })

  test("schedules failure projection without replacing the generation error", async () => {
    const coordinator = new WebPluginGenerationProjectionCoordinator()
    const generationError = new Error("Generation failed")
    const reloadError = new Error("Renderer reload failed")
    const reloadAuthoritative = mock(async () => {
      throw reloadError
    })

    await expect(
      coordinator.execute(
        ref,
        async () => {
          throw generationError
        },
        reloadAuthoritative,
      ),
    ).rejects.toBe(generationError)
    await expect(coordinator.wait(ref, new AbortController().signal)).rejects.toBe(reloadError)
    expect(reloadAuthoritative).toHaveBeenCalledTimes(2)
  })

  test("repairs a retained reload failure before allowing a later state write", async () => {
    const coordinator = new WebPluginGenerationProjectionCoordinator()
    let attempts = 0
    const reloadAuthoritative = mock(async () => {
      attempts += 1
      if (attempts === 1) throw new Error("Transient renderer reload failure")
    })

    await coordinator.execute(ref, async () => undefined, reloadAuthoritative)

    await expect(coordinator.wait(ref, new AbortController().signal)).resolves.toBeUndefined()
    expect(reloadAuthoritative).toHaveBeenCalledTimes(2)
  })

  test("shares one terminal retry result across concurrent Canvas waiters", async () => {
    const coordinator = new WebPluginGenerationProjectionCoordinator()
    const initialError = new Error("Initial renderer reload failed")
    const retryError = new Error("Retry renderer reload failed")
    let attempts = 0
    const reloadAuthoritative = mock(async () => {
      attempts += 1
      throw attempts === 1 ? initialError : retryError
    })

    await coordinator.execute(ref, async () => undefined, reloadAuthoritative)
    const first = coordinator.wait(ref, new AbortController().signal)
    const second = coordinator.wait(
      { ...ref, nodeId: "node-2", pluginId: "another-plugin" },
      new AbortController().signal,
    )

    expect(await Promise.allSettled([first, second])).toEqual([
      { reason: retryError, status: "rejected" },
      { reason: retryError, status: "rejected" },
    ])
    expect(reloadAuthoritative).toHaveBeenCalledTimes(2)
  })

  test("lets a later state write retry a previously terminal Canvas projection", async () => {
    const coordinator = new WebPluginGenerationProjectionCoordinator()
    const initialError = new Error("Initial renderer reload failed")
    const retryError = new Error("Retry renderer reload failed")
    let attempts = 0
    const reloadAuthoritative = mock(async () => {
      attempts += 1
      if (attempts === 1) throw initialError
      if (attempts === 2) throw retryError
    })

    await coordinator.execute(ref, async () => undefined, reloadAuthoritative)
    await expect(coordinator.wait(ref, new AbortController().signal)).rejects.toBe(retryError)
    await expect(coordinator.wait(ref, new AbortController().signal)).resolves.toBeUndefined()
    expect(reloadAuthoritative).toHaveBeenCalledTimes(3)
  })

  test("lets a closed Plugin frame stop waiting for a pending projection", async () => {
    const coordinator = new WebPluginGenerationProjectionCoordinator()
    const projection = deferred()
    await coordinator.execute(
      ref,
      async () => undefined,
      () => projection.promise,
    )
    const controller = new AbortController()
    const canceled = new Error("Plugin frame was closed")

    const waiting = coordinator.wait(ref, controller.signal)
    controller.abort(canceled)

    await expect(waiting).rejects.toBe(canceled)
    projection.resolve()
  })
})
