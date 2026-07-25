import { describe, expect, mock, test } from "bun:test"
import { projectAssetGcMinimumIntervalMs, projectAssetGcOpenDelayMs, projectAssetGcRetryMs } from "@convax/project/node"
import { ProjectAssetGcScheduler } from "./project-asset-gc-scheduler"

describe("ProjectAssetGcScheduler", () => {
  test("coalesces duplicate opens and schedules success at the open and daily intervals", async () => {
    const timers = new FakeTimers()
    const scan = mock(async () => undefined)
    const scheduler = new ProjectAssetGcScheduler({ gc: { scan }, scheduleTimeout: timers.schedule })

    scheduler.open("project_one")
    scheduler.open("project_one")
    expect(timers.pendingDelays()).toEqual([projectAssetGcOpenDelayMs])

    timers.runNext()
    await flush()
    expect(scan).toHaveBeenCalledTimes(1)
    expect(scan).toHaveBeenCalledWith("project_one")
    expect(timers.pendingDelays()).toEqual([projectAssetGcMinimumIntervalMs])

    timers.runNext()
    await flush()
    expect(scan).toHaveBeenCalledTimes(2)

    scheduler.dispose()
  })

  test("retries failures after fifteen minutes without overlapping the same Project", async () => {
    const timers = new FakeTimers()
    const first = deferred()
    let calls = 0
    const scan = mock(async () => {
      calls += 1
      if (calls === 1) return first.promise
    })
    const scheduler = new ProjectAssetGcScheduler({ gc: { scan }, scheduleTimeout: timers.schedule })
    scheduler.open("project_one")
    timers.runNext()
    await flush()
    scheduler.request("project_one")
    scheduler.request("project_one")
    expect(scan).toHaveBeenCalledTimes(1)
    expect(timers.pendingDelays()).toEqual([])

    first.reject(new Error("injected scan failure"))
    await flush()
    expect(timers.pendingDelays()).toEqual([projectAssetGcRetryMs])

    scheduler.dispose()
  })

  test("runs at most one Project globally and skips a queued Project closed before execution", async () => {
    const timers = new FakeTimers()
    const first = deferred()
    const entered: string[] = []
    const scan = mock(async (projectId: string) => {
      entered.push(projectId)
      if (projectId === "project_one") await first.promise
    })
    const scheduler = new ProjectAssetGcScheduler({ gc: { scan }, scheduleTimeout: timers.schedule })
    scheduler.open("project_one")
    scheduler.open("project_two")
    scheduler.request("project_one")
    scheduler.request("project_two")
    timers.runNext()
    timers.runNext()
    await flush()
    expect(entered).toEqual(["project_one"])

    scheduler.close("project_two")
    first.resolve()
    await flush()
    expect(entered).toEqual(["project_one"])
    expect(timers.pendingDelays()).toEqual([projectAssetGcMinimumIntervalMs])

    scheduler.dispose()
  })

  test("closeAll and dispose cancel timers and never force a scan", async () => {
    const timers = new FakeTimers()
    const scan = mock(async () => undefined)
    const scheduler = new ProjectAssetGcScheduler({ gc: { scan }, scheduleTimeout: timers.schedule })
    scheduler.open("project_one")
    scheduler.open("project_two")
    scheduler.closeAll()
    expect(timers.pendingDelays()).toEqual([])
    expect(scan).not.toHaveBeenCalled()

    scheduler.open("project_three")
    scheduler.dispose()
    expect(timers.pendingDelays()).toEqual([])
    expect(() => scheduler.open("project_four")).toThrow(/disposed/i)
    expect(() => scheduler.request("project_three")).toThrow(/disposed/i)
    await flush()
    expect(scan).not.toHaveBeenCalled()
  })

  test("invalidates slow open leases on close and closeAll while allowing a new lease", () => {
    const timers = new FakeTimers()
    const scheduler = new ProjectAssetGcScheduler({
      gc: { scan: mock(async () => undefined) },
      scheduleTimeout: timers.schedule,
    })

    const closedLease = scheduler.prepareOpen("project_one")
    scheduler.close("project_one")
    closedLease()
    expect(timers.pendingDelays()).toEqual([])

    const reopenedLease = scheduler.prepareOpen("project_one")
    reopenedLease()
    expect(timers.pendingDelays()).toEqual([projectAssetGcOpenDelayMs])

    const closeAllLease = scheduler.prepareOpen("project_two")
    scheduler.closeAll()
    closeAllLease()
    expect(timers.pendingDelays()).toEqual([])

    const afterCloseAllLease = scheduler.prepareOpen("project_two")
    afterCloseAllLease()
    expect(timers.pendingDelays()).toEqual([projectAssetGcOpenDelayMs])

    scheduler.dispose()
  })
})

class FakeTimers {
  readonly #timers: Array<{ active: boolean; callback: () => void; delay: number }> = []

  readonly schedule = (callback: () => void, delay: number) => {
    const timer = { active: true, callback, delay }
    this.#timers.push(timer)
    return () => {
      timer.active = false
    }
  }

  pendingDelays() {
    return this.#timers.filter((timer) => timer.active).map((timer) => timer.delay)
  }

  runNext() {
    const timer = this.#timers.find((candidate) => candidate.active)
    if (!timer) throw new Error("No pending timer")
    timer.active = false
    timer.callback()
  }
}

function deferred() {
  let resolve!: () => void
  let reject!: (error: Error) => void
  const promise = new Promise<void>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, reject, resolve }
}

async function flush() {
  await Bun.sleep(0)
  await Bun.sleep(0)
}
