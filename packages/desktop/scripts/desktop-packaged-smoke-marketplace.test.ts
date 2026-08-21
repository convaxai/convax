import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { expect, test } from "bun:test"

import {
  assertMarketplaceSmokeSnapshot,
  assertNoLegacyDefaultCapabilityReceipt,
  packagedStartupStageReached,
} from "./desktop-packaged-smoke-marketplace"

test("packaged startup markers remain observable without a provisioning stage", () => {
  expect(packagedStartupStageReached("2026-08-14T00:00:00.000Z window-created\n", "window-created")).toBe(true)
})

test("fresh packaged Marketplace contains only the Official source entry and no installation", () => {
  expect(() =>
    assertMarketplaceSmokeSnapshot({
      catalogCount: 0,
      installedCount: 0,
      marketplaceSurfaceVisible: true,
      settingsSources: [
        {
          id: "convax-official",
          removable: false,
          repository: "convaxai/convax-plugins",
        },
      ],
    }),
  ).not.toThrow()
  expect(() =>
    assertMarketplaceSmokeSnapshot({
      catalogCount: 1,
      installedCount: 1,
      marketplaceSurfaceVisible: true,
      settingsSources: [
        {
          id: "convax-official",
          removable: false,
          repository: "convaxai/convax-plugins",
        },
      ],
    }),
  ).toThrow("provisioned")
})

test("does not recreate the retired default capability receipt", async () => {
  const userDataRoot = await fs.mkdtemp(path.join(os.tmpdir(), "convax-default-receipt-smoke-"))
  try {
    await expect(assertNoLegacyDefaultCapabilityReceipt(userDataRoot)).resolves.toBeUndefined()
    await fs.writeFile(path.join(userDataRoot, "default-capabilities.json"), "{}")
    await expect(assertNoLegacyDefaultCapabilityReceipt(userDataRoot)).rejects.toThrow("legacy default capability")
  } finally {
    await fs.rm(userDataRoot, { force: true, recursive: true })
  }
})
