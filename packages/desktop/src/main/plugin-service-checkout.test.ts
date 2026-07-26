import { describe, expect, test } from "bun:test"

import { parsePluginServiceCheckoutResult } from "./plugin-service-checkout"

describe("Plugin service Checkout result", () => {
  test("accepts only a canonical HTTPS system-browser URL", () => {
    expect(
      parsePluginServiceCheckoutResult({
        checkout_id: "checkout_12345678",
        checkout_url: "https://checkout.example.test/session/123?provider=secure",
        schema: "convax.plugin-service-checkout/1",
      }),
    ).toMatchObject({ checkoutId: "checkout_12345678" })
    expect(() =>
      parsePluginServiceCheckoutResult({
        checkout_id: "checkout_12345678",
        checkout_url: "http://checkout.example.test/session/123",
        schema: "convax.plugin-service-checkout/1",
      }),
    ).toThrow("canonical HTTPS")
    expect(() =>
      parsePluginServiceCheckoutResult({
        checkout_id: "checkout_12345678",
        checkout_url: "https://user:password@checkout.example.test/session/123",
        schema: "convax.plugin-service-checkout/1",
      }),
    ).toThrow("canonical HTTPS")
  })
})
