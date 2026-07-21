import { describe, expect, test } from "bun:test"
import { CanvasExternalMutationLeaseController } from "./external-mutation-lease"

function deferred() {
  let reject!: (error: unknown) => void
  let resolve!: () => void
  const promise = new Promise<void>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, reject, resolve }
}

describe("Canvas external mutation lease", () => {
  test("enters read-only, flushes, reloads a committed mutation, and then releases", async () => {
    const events: string[] = []
    const lease = new CanvasExternalMutationLeaseController({
      enter: () => events.push("enter"),
      flush: async () => {
        events.push("flush")
      },
      reloadCommitted: async () => {
        events.push("reload")
      },
      release: () => events.push("release"),
    })

    await lease.begin()
    expect(lease.locked).toBeTrue()
    await lease.end("committed")

    expect(events).toEqual(["enter", "flush", "reload", "release"])
    expect(lease.locked).toBeFalse()
  })

  test("an aborted mutation only releases the editor", async () => {
    let reloads = 0
    let releases = 0
    const lease = new CanvasExternalMutationLeaseController({
      enter: () => undefined,
      flush: async () => undefined,
      reloadCommitted: async () => {
        reloads += 1
      },
      release: () => {
        releases += 1
      },
    })

    await lease.begin()
    await lease.end("aborted")

    expect(reloads).toBe(0)
    expect(releases).toBe(1)
    expect(lease.locked).toBeFalse()
  })

  test("releases after a committed reload failure and can acquire a later lease", async () => {
    let failReload = true
    let releases = 0
    const lease = new CanvasExternalMutationLeaseController({
      enter: () => undefined,
      flush: async () => undefined,
      reloadCommitted: async () => {
        if (failReload) throw new Error("reload failed")
      },
      release: () => {
        releases += 1
      },
    })

    await lease.begin()
    await expect(lease.end("committed")).rejects.toThrow("reload failed")
    expect(lease.locked).toBeFalse()
    expect(releases).toBe(1)

    failReload = false
    await lease.begin()
    await lease.end("committed")
    expect(releases).toBe(2)
  })

  test("rejects begin/end reentry while preserving the original lease", async () => {
    const flushing = deferred()
    const lease = new CanvasExternalMutationLeaseController({
      enter: () => undefined,
      flush: () => flushing.promise,
      reloadCommitted: async () => undefined,
      release: () => undefined,
    })

    const beginning = lease.begin()
    await expect(lease.begin()).rejects.toThrow("already active")
    await expect(lease.end("aborted")).rejects.toThrow("No active")
    flushing.resolve()
    await beginning

    const ending = lease.end("committed")
    await expect(lease.end("aborted")).rejects.toThrow("No active")
    await ending
  })

  test("flushes before external commit and never saves the old document during committed reload", async () => {
    let editorDocument = "local-v1"
    let persistedDocument = "local-v0"
    const saves: string[] = []
    const lease = new CanvasExternalMutationLeaseController({
      enter: () => undefined,
      flush: async () => {
        saves.push(editorDocument)
        persistedDocument = editorDocument
      },
      reloadCommitted: async () => {
        editorDocument = persistedDocument
      },
      release: () => undefined,
    })

    await lease.begin()
    persistedDocument = "external-v2"
    await lease.end("committed")

    expect(editorDocument).toBe("external-v2")
    expect(saves).toEqual(["local-v1"])
    expect(persistedDocument).toBe("external-v2")
  })

  test("releases when begin cannot flush", async () => {
    let releases = 0
    const lease = new CanvasExternalMutationLeaseController({
      enter: () => undefined,
      flush: async () => {
        throw new Error("save failed")
      },
      reloadCommitted: async () => undefined,
      release: () => {
        releases += 1
      },
    })

    await expect(lease.begin()).rejects.toThrow("save failed")
    expect(lease.locked).toBeFalse()
    expect(releases).toBe(1)
  })

  test("cancellation releases a beginning lease even when its flush never settles", async () => {
    let releases = 0
    const lease = new CanvasExternalMutationLeaseController({
      enter: () => undefined,
      flush: () => new Promise<void>(() => undefined),
      reloadCommitted: async () => undefined,
      release: () => {
        releases += 1
      },
    })
    const controller = new AbortController()
    const beginning = lease.begin(controller.signal)
    controller.abort(new DOMException("Main canceled prepare", "AbortError"))

    await expect(beginning).rejects.toThrow("Main canceled prepare")
    expect(lease.locked).toBeFalse()
    expect(releases).toBe(1)
  })
})
