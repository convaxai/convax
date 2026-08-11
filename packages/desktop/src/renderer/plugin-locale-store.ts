import { parsePortablePluginLocale } from "@convax/plugin-sdk"
import type { AppLocale } from "./app-language"

/** Renderer-owned preference projection shared by mounted Plugin surfaces. */
export class DesktopPluginLocaleStore {
  private readonly listeners = new Set<() => void>()
  private locale: AppLocale

  constructor(initialLocale: AppLocale) {
    parsePortablePluginLocale(initialLocale)
    this.locale = initialLocale
  }

  getSnapshot = () => this.locale

  set(nextLocale: AppLocale) {
    parsePortablePluginLocale(nextLocale)
    if (nextLocale === this.locale) return false
    this.locale = nextLocale
    for (const listener of this.listeners) listener()
    return true
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
}
