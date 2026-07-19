import { describe, expect, test } from "bun:test"
import { CanvasReloadQueue } from "./reload-queue"

function deferred() {
  let reject: (error: unknown) => void = () => undefined
  let resolve: () => void = () => undefined
  const promise = new Promise<void>((next, fail) => {
    reject = fail
    resolve = next
  })
  return { promise, reject, resolve }
}

async function advanceMicrotasks() {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

describe("CanvasReloadQueue", () => {
  test("runs a trailing reload and keeps concurrent callers pending until it completes", async () => {
    const queue = new CanvasReloadQueue()
    const reloads = [deferred(), deferred()]
    let reloadCount = 0
    let repositoryRevision = 436
    let renderedRevision = 0
    const reload = async () => {
      const revision = repositoryRevision
      await reloads[reloadCount++].promise
      renderedRevision = revision
    }

    const first = queue.request(reload)
    repositoryRevision = 443
    const second = queue.request(reload)
    let settled = false
    void Promise.all([first, second]).then(() => {
      settled = true
    })

    expect(reloadCount).toBe(1)
    reloads[0].resolve()
    await advanceMicrotasks()

    expect(reloadCount).toBe(2)
    expect(renderedRevision).toBe(436)
    expect(settled).toBeFalse()

    reloads[1].resolve()
    await Promise.all([first, second])
    expect(renderedRevision).toBe(443)
    expect(settled).toBeTrue()
  })

  test("coalesces a burst of requests into one trailing reload", async () => {
    const queue = new CanvasReloadQueue()
    const reloads = [deferred(), deferred()]
    let reloadCount = 0
    const reload = () => reloads[reloadCount++].promise

    const requests = [queue.request(reload)]
    requests.push(queue.request(reload), queue.request(reload), queue.request(reload))
    reloads[0].resolve()
    await advanceMicrotasks()

    expect(reloadCount).toBe(2)
    reloads[1].resolve()
    await Promise.all(requests)
    expect(reloadCount).toBe(2)
  })

  test("runs another reload when a request arrives during the trailing reload", async () => {
    const queue = new CanvasReloadQueue()
    const reloads = [deferred(), deferred(), deferred()]
    let reloadCount = 0
    const reload = () => reloads[reloadCount++].promise

    const requests = [queue.request(reload), queue.request(reload)]
    reloads[0].resolve()
    await advanceMicrotasks()
    expect(reloadCount).toBe(2)

    requests.push(queue.request(reload))
    reloads[1].resolve()
    await advanceMicrotasks()
    expect(reloadCount).toBe(3)

    reloads[2].resolve()
    await Promise.all(requests)
  })

  test("rejects current waiters after a failure and allows a later request to retry", async () => {
    const queue = new CanvasReloadQueue()
    const failure = new Error("reload failed")
    const failed = deferred()
    let reloadCount = 0
    const reload = () => {
      reloadCount += 1
      return reloadCount === 1 ? failed.promise : Promise.resolve()
    }

    const first = queue.request(reload)
    const second = queue.request(reload)
    failed.reject(failure)

    expect(await Promise.allSettled([first, second])).toEqual([
      { reason: failure, status: "rejected" },
      { reason: failure, status: "rejected" },
    ])
    await queue.request(reload)
    expect(reloadCount).toBe(2)
  })
})
