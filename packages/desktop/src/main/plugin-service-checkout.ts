export const pluginServiceCheckoutSchema = "convax.plugin-service-checkout/1" as const

export interface PluginServiceCheckoutResult {
  checkoutId: string
  checkoutUrl: string
  schema: typeof pluginServiceCheckoutSchema
}

export interface PluginServiceCheckoutNavigation {
  open(url: string): Promise<void>
}

function requireRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Plugin service Checkout result must be an object")
  }
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) {
    throw new Error("Plugin service Checkout result must be an object")
  }
  return value as Record<string, unknown>
}

export function parsePluginServiceCheckoutResult(value: unknown): PluginServiceCheckoutResult {
  const input = requireRecord(value)
  const keys = Object.keys(input)
  if (
    keys.length !== 3 ||
    !keys.every((key) => ["checkout_id", "checkout_url", "schema"].includes(key)) ||
    input.schema !== pluginServiceCheckoutSchema ||
    typeof input.checkout_id !== "string" ||
    !/^[A-Za-z0-9_-]{8,191}$/.test(input.checkout_id)
  ) {
    throw new Error("Plugin service Checkout result is invalid")
  }
  if (
    typeof input.checkout_url !== "string" ||
    !input.checkout_url ||
    input.checkout_url.length > 4_096 ||
    input.checkout_url !== input.checkout_url.trim()
  ) {
    throw new Error("Plugin service Checkout URL is invalid")
  }
  let url: URL
  try {
    url = new URL(input.checkout_url)
  } catch {
    throw new Error("Plugin service Checkout URL is invalid")
  }
  if (url.protocol !== "https:" || url.username || url.password || url.hash || url.href !== input.checkout_url) {
    throw new Error("Plugin service Checkout URL must be canonical HTTPS")
  }
  return {
    checkoutId: input.checkout_id,
    checkoutUrl: url.href,
    schema: pluginServiceCheckoutSchema,
  }
}
