import { describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"

import { assertPluginApiHistoryPolicy } from "./plugin-api-history-policy"

const bytes = (value: unknown) => new TextEncoder().encode(typeof value === "string" ? value : JSON.stringify(value))
const sha256 = (value: Uint8Array) => createHash("sha256").update(value).digest("hex")
const snapshotV1 = bytes('{"schema":"convax.plugin-api-catalog/2","version":"1.0.0","apis":[]}\n')
const snapshotV2 = bytes('{"schema":"convax.plugin-api-catalog/3","version":"2.0.0","apis":[]}\n')
const receiptV1 = {
  artifactSchema: "convax.plugin-api-catalog/2",
  sha256: sha256(snapshotV1),
  version: "1.0.0",
  wireSchemaDialect: "convax.plugin-api-wire-schema/2",
}
const ledger = (retired: readonly unknown[]) => bytes({ schema: "convax.plugin-api-history-ledger/1", retired })

describe("Plugin API base-aware history policy", () => {
  test("admits only the current snapshot plus a ledger receipt for immutable base bytes", () => {
    expect(() =>
      assertPluginApiHistoryPolicy({
        baseHistory: new Map([["1.0.0.json", snapshotV1]]),
        currentHistory: new Map([
          ["1.0.0.json", snapshotV1],
          ["2.0.0.json", snapshotV2],
          ["ledger.json", ledger([receiptV1])],
        ]),
        currentVersion: "2.0.0",
      }),
    ).not.toThrow()
  })

  test("rejects modifying or deleting a base snapshot", () => {
    expect(() =>
      assertPluginApiHistoryPolicy({
        baseHistory: new Map([["1.0.0.json", snapshotV1]]),
        currentHistory: new Map([["1.0.0.json", bytes("changed")]]),
        currentVersion: "2.0.0",
      }),
    ).toThrow("existing receipt bytes changed")
    expect(() =>
      assertPluginApiHistoryPolicy({
        baseHistory: new Map([["1.0.0.json", snapshotV1]]),
        currentHistory: new Map(),
        currentVersion: "2.0.0",
      }),
    ).toThrow("existing receipt was deleted")
  })

  test("rejects a new non-current snapshot", () => {
    expect(() =>
      assertPluginApiHistoryPolicy({
        baseHistory: new Map([["1.0.0.json", snapshotV1]]),
        currentHistory: new Map([
          ["1.0.0.json", snapshotV1],
          ["1.1.0.json", bytes("{}")],
          ["2.0.0.json", snapshotV2],
        ]),
        currentVersion: "2.0.0",
      }),
    ).toThrow("new snapshots must contain only 2.0.0.json")
  })

  test("rejects history without the exact current-version snapshot", () => {
    expect(() =>
      assertPluginApiHistoryPolicy({
        baseHistory: new Map([["1.0.0.json", snapshotV1]]),
        currentHistory: new Map([["1.0.0.json", snapshotV1]]),
        currentVersion: "2.0.0",
      }),
    ).toThrow("current snapshot is missing: 2.0.0.json")
  })

  test("preserves every base ledger receipt as an immutable prefix", () => {
    const baseLedger = ledger([receiptV1])
    expect(() =>
      assertPluginApiHistoryPolicy({
        baseHistory: new Map([
          ["1.0.0.json", snapshotV1],
          ["ledger.json", baseLedger],
        ]),
        currentHistory: new Map([
          ["1.0.0.json", snapshotV1],
          ["2.0.0.json", snapshotV2],
          ["ledger.json", ledger([])],
        ]),
        currentVersion: "2.0.0",
      }),
    ).toThrow("existing ledger receipts were deleted")
    expect(() =>
      assertPluginApiHistoryPolicy({
        baseHistory: new Map([
          ["1.0.0.json", snapshotV1],
          ["ledger.json", baseLedger],
        ]),
        currentHistory: new Map([
          ["1.0.0.json", snapshotV1],
          ["2.0.0.json", snapshotV2],
          ["ledger.json", ledger([{ ...receiptV1, sha256: "0".repeat(64) }])],
        ]),
        currentVersion: "2.0.0",
      }),
    ).toThrow("modified or reordered")
  })

  test("rejects appended receipts that are not bound to immutable base bytes", () => {
    expect(() =>
      assertPluginApiHistoryPolicy({
        baseHistory: new Map([["1.0.0.json", snapshotV1]]),
        currentHistory: new Map([
          ["1.0.0.json", snapshotV1],
          ["2.0.0.json", snapshotV2],
          ["ledger.json", ledger([{ ...receiptV1, sha256: "0".repeat(64) }])],
        ]),
        currentVersion: "2.0.0",
      }),
    ).toThrow("does not match immutable base bytes")
    expect(() =>
      assertPluginApiHistoryPolicy({
        baseHistory: new Map([["1.0.0.json", snapshotV1]]),
        currentHistory: new Map([
          ["1.0.0.json", snapshotV1],
          ["2.0.0.json", snapshotV2],
          ["ledger.json", ledger([{ ...receiptV1, version: "2.0.0", sha256: sha256(snapshotV2) }])],
        ]),
        currentVersion: "2.0.0",
      }),
    ).toThrow("current version cannot be appended")
  })
})
