import { expect, test } from "bun:test"
import { createMarketplaceStartupProvisioning } from "./marketplace-startup-provisioning"

test("Marketplace startup provisioning contains a fail-closed default-install error so window creation can continue", async () => {
  const diagnostics: Array<{ errorType: string }> = []
  let windowBootstrapContinued = false

  const provisioning = createMarketplaceStartupProvisioning({
    async provision() {
      throw new Error("private package and path details")
    },
    report(diagnostic) {
      diagnostics.push(diagnostic)
    },
  })
  const result = await provisioning.start()
  windowBootstrapContinued = true

  expect(windowBootstrapContinued).toBe(true)
  expect(result).toEqual({ errorType: "Error", ok: false })
  expect(diagnostics).toEqual([{ errorType: "Error" }])
})

test("Marketplace startup provisioning reports nothing after success", async () => {
  const diagnostics: Array<{ errorType: string }> = []

  const provisioning = createMarketplaceStartupProvisioning({
    async provision() {},
    report(diagnostic) {
      diagnostics.push(diagnostic)
    },
  })
  expect(await provisioning.start()).toEqual({ ok: true })

  expect(diagnostics).toEqual([])
})

test("Marketplace startup provisioning is single-flight across repeated window lifecycle starts", async () => {
  let release: (() => void) | undefined
  const pending = new Promise<void>((resolve) => {
    release = resolve
  })
  let attempts = 0
  const provisioning = createMarketplaceStartupProvisioning({
    async provision() {
      attempts += 1
      await pending
    },
    report() {
      throw new Error("not expected")
    },
  })

  const first = provisioning.start()
  const second = provisioning.start()
  expect(first).toBe(second)
  expect(attempts).toBe(1)

  release!()
  await first
  await provisioning.start()
  expect(attempts).toBe(1)
})

test("Marketplace startup shutdown drain neither starts nor permits late provisioning", async () => {
  let attempts = 0
  const provisioning = createMarketplaceStartupProvisioning({
    async provision() {
      attempts += 1
    },
    report() {
      throw new Error("not expected")
    },
  })

  expect(await provisioning.closeAndDrainStarted()).toBeNull()
  expect(attempts).toBe(0)
  expect(await provisioning.start()).toEqual({ errorType: "MarketplaceStartupProvisioningClosed", ok: false })
  expect(attempts).toBe(0)
})

test("Marketplace startup shutdown drain waits for an already-started task", async () => {
  let release: (() => void) | undefined
  const pending = new Promise<void>((resolve) => {
    release = resolve
  })
  let attempts = 0
  const provisioning = createMarketplaceStartupProvisioning({
    async provision() {
      attempts += 1
      await pending
    },
    report() {
      throw new Error("not expected")
    },
  })

  const started = provisioning.start()
  const drained = provisioning.closeAndDrainStarted()
  expect(attempts).toBe(1)
  release!()
  expect(await drained).toEqual({ ok: true })
  expect(await started).toEqual({ ok: true })
  expect(attempts).toBe(1)
})

test("Marketplace startup provisioning keeps an explicit failure result when diagnostic reporting throws", async () => {
  const provisioning = createMarketplaceStartupProvisioning({
    async provision() {
      throw new TypeError("private details")
    },
    report() {
      throw new Error("diagnostic sink failed")
    },
  })

  expect(await provisioning.start()).toEqual({ errorType: "TypeError", ok: false })
})
