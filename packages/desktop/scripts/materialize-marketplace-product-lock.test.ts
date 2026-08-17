import { expect, test } from "bun:test"

import { runBoundedMarketplaceTasks } from "./materialize-marketplace-product-lock"

test("Marketplace artifact work stays within the explicit concurrency bound", async () => {
  let active = 0
  let peak = 0
  const completed: number[] = []

  await runBoundedMarketplaceTasks({
    concurrency: 3,
    items: [0, 1, 2, 3, 4, 5, 6],
    task: async (item) => {
      active += 1
      peak = Math.max(peak, active)
      await new Promise((resolve) => setTimeout(resolve, item % 2 === 0 ? 8 : 2))
      completed.push(item)
      active -= 1
    },
  })

  expect(peak).toBe(3)
  expect(completed.toSorted()).toEqual([0, 1, 2, 3, 4, 5, 6])
})

test("Marketplace artifact work stops scheduling after the first failure", async () => {
  const started: number[] = []

  await expect(
    runBoundedMarketplaceTasks({
      concurrency: 2,
      items: [0, 1, 2, 3, 4],
      task: async (item) => {
        started.push(item)
        if (item === 0) throw new Error("download failed")
        await new Promise((resolve) => setTimeout(resolve, 5))
      },
    }),
  ).rejects.toThrow("download failed")
  expect(started).toEqual([0, 1])
})

test("Marketplace artifact work rejects unsafe concurrency values", async () => {
  await expect(
    runBoundedMarketplaceTasks({ concurrency: 0, items: [], task: async () => undefined }),
  ).rejects.toThrow("integer from 1 through 8")
  await expect(
    runBoundedMarketplaceTasks({ concurrency: 9, items: [], task: async () => undefined }),
  ).rejects.toThrow("integer from 1 through 8")
})

test("Marketplace artifact work preserves non-Error task failures", async () => {
  await expect(
    runBoundedMarketplaceTasks({
      concurrency: 1,
      items: [0],
      task: () => Promise.reject(undefined),
    }),
  ).rejects.toBeUndefined()
})
