import { describe, expect, test } from "bun:test"
import {
  InMemoryAtomicControlStateStore,
  SystemControlClock,
  WebCryptoControlRandomSource,
} from "../src"

interface TestState {
  readonly values: readonly number[]
}

describe("Web-standard control state adapters", () => {
  test("serializes concurrent transactions for one opaque deployment partition", async () => {
    const store = new InMemoryAtomicControlStateStore<TestState>()
    const results = await Promise.all(
      [1, 2, 3].map((value) =>
        store.transact("partition-a", (transaction) => {
          const current = transaction.read() ?? { values: [] }
          transaction.write({ values: [...current.values, value] })
          return current.values.length + 1
        }),
      ),
    )
    expect(results).toEqual([1, 2, 3])
    await store.transact("partition-a", (transaction) => {
      expect(transaction.read()?.values).toEqual([1, 2, 3])
    })
  })

  test("rolls back staged state when the operation fails", async () => {
    const store = new InMemoryAtomicControlStateStore<TestState>()
    await expect(
      store.transact("partition-a", (transaction) => {
        transaction.write({ values: [99] })
        throw new Error("signer failed")
      }),
    ).rejects.toThrow("signer failed")
    await store.transact("partition-a", (transaction) => expect(transaction.read()).toBeNull())
  })

  test("returns defensive structured clones instead of mutable shared authority", async () => {
    const store = new InMemoryAtomicControlStateStore<{ values: number[] }>()
    const source = { values: [1] }
    await store.transact("partition-a", (transaction) => transaction.write(source))
    source.values.push(2)
    await store.transact("partition-a", (transaction) => {
      const read = transaction.read()!
      read.values.push(3)
    })
    await store.transact("partition-a", (transaction) => expect(transaction.read()).toEqual({ values: [1] }))
  })

  test("clock and randomness use Web-standard surfaces", () => {
    expect(new SystemControlClock().nowEpochMilliseconds()).toBeGreaterThan(0)
    const bytes = new Uint8Array(32)
    new WebCryptoControlRandomSource().fill(bytes)
    expect(bytes.some((byte) => byte !== 0)).toBeTrue()
  })
})
