import { expect, test } from "bun:test"
import { provisionMarketplaceForStartup } from "./marketplace-startup-provisioning"

test("Marketplace startup provisioning contains a fail-closed preinstall error so window creation can continue", async () => {
  const diagnostics: Array<{ errorType: string }> = []
  let windowBootstrapContinued = false

  await provisionMarketplaceForStartup({
    async provision() {
      throw new Error("private package and path details")
    },
    report(diagnostic) {
      diagnostics.push(diagnostic)
    },
  })
  windowBootstrapContinued = true

  expect(windowBootstrapContinued).toBe(true)
  expect(diagnostics).toEqual([{ errorType: "Error" }])
})

test("Marketplace startup provisioning reports nothing after success", async () => {
  const diagnostics: Array<{ errorType: string }> = []

  await provisionMarketplaceForStartup({
    async provision() {},
    report(diagnostic) {
      diagnostics.push(diagnostic)
    },
  })

  expect(diagnostics).toEqual([])
})
