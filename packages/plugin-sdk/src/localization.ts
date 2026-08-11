import { assertPortableKeys, deepFreezePortable, portableRecord, portableText } from "./primitives"

export const maximumPortablePluginLocales = 16
export const maximumPortablePluginMessagesPerLocale = 512
export const maximumPortablePluginLocalizationBytes = 256 * 1024

const portablePluginLocalePattern =
  /^[a-z]{2,3}(?:-[A-Z][a-z]{3})?(?:-(?:[A-Z]{2}|[0-9]{3}))?(?:-(?:[a-z0-9]{5,8}|[0-9][a-z0-9]{3}))*$/u
const portablePluginMessageKeyPattern = /^[a-z][a-z0-9]*(?:[._/-][a-z0-9]+)*$/u

export type PortablePluginLocale = string

export interface PortablePluginI18n {
  readonly defaultLocale: PortablePluginLocale
  readonly messages: Readonly<Record<PortablePluginLocale, Readonly<Record<string, string>>>>
}

/**
 * A Host-rendered Plugin message keeps a bounded source fallback. `key` opts
 * into the manifest-level i18n resources. The direct zh-CN field is retained
 * only for compatibility with the first convax.plugin/8 UI contribution shape.
 */
export interface PortablePluginLocalizedText {
  readonly default: string
  readonly key?: string
  readonly "zh-CN"?: string
}

export const portablePluginReservedMessageKeys = Object.freeze({
  description: "plugin.description",
  name: "plugin.name",
})

export function parsePortablePluginLocale(value: unknown, label = "Plugin locale"): PortablePluginLocale {
  const locale = portableText(value, label, 35)
  if (!portablePluginLocalePattern.test(locale)) {
    throw new TypeError(`${label} must be a canonical BCP-47 language tag without extensions`)
  }
  return locale
}

export function parsePortablePluginMessageKey(value: unknown, label = "Plugin message key") {
  const key = portableText(value, label, 128)
  if (!portablePluginMessageKeyPattern.test(key)) {
    throw new TypeError(`${label} must be a stable lowercase message key`)
  }
  return key
}

export function parsePortablePluginI18n(value: unknown): PortablePluginI18n {
  const input = portableRecord(value, "Plugin i18n")
  assertPortableKeys(input, ["defaultLocale", "messages"], "Plugin i18n")
  const defaultLocale = parsePortablePluginLocale(input.defaultLocale, "Plugin i18n defaultLocale")
  const rawMessages = portableRecord(input.messages, "Plugin i18n messages")
  const localeEntries = Object.entries(rawMessages)
  if (localeEntries.length < 1 || localeEntries.length > maximumPortablePluginLocales) {
    throw new TypeError(`Plugin i18n must declare between 1 and ${maximumPortablePluginLocales} locales`)
  }

  const messages: Record<string, Readonly<Record<string, string>>> = Object.create(null)
  for (const [rawLocale, rawResource] of localeEntries) {
    const locale = parsePortablePluginLocale(rawLocale, `Plugin i18n locale ${rawLocale}`)
    const resource = portableRecord(rawResource, `Plugin i18n ${locale} messages`)
    const messageEntries = Object.entries(resource)
    if (messageEntries.length > maximumPortablePluginMessagesPerLocale) {
      throw new TypeError(
        `Plugin i18n ${locale} messages must contain at most ${maximumPortablePluginMessagesPerLocale} entries`,
      )
    }
    const parsedResource: Record<string, string> = Object.create(null)
    for (const [rawKey, rawMessage] of messageEntries) {
      const key = parsePortablePluginMessageKey(rawKey, `Plugin i18n ${locale} message key`)
      parsedResource[key] = portableText(rawMessage, `Plugin i18n ${locale}.${key}`, 4_096)
    }
    messages[locale] = parsedResource
  }
  if (!Object.prototype.hasOwnProperty.call(messages, defaultLocale)) {
    throw new TypeError("Plugin i18n messages must contain the declared defaultLocale")
  }
  const parsed = { defaultLocale, messages }
  if (new TextEncoder().encode(JSON.stringify(parsed)).byteLength > maximumPortablePluginLocalizationBytes) {
    throw new TypeError(`Plugin i18n exceeds ${maximumPortablePluginLocalizationBytes} bytes`)
  }
  return deepFreezePortable(parsed)
}

export function parsePortablePluginLocalizedText(
  value: unknown,
  label: string,
  maximum: number,
): PortablePluginLocalizedText {
  const input = portableRecord(value, label)
  assertPortableKeys(input, ["default", "key", "zh-CN"], label)
  return deepFreezePortable({
    default: portableText(input.default, `${label} default`, maximum),
    ...(input.key === undefined ? {} : { key: parsePortablePluginMessageKey(input.key, `${label} key`) }),
    ...(input["zh-CN"] === undefined ? {} : { "zh-CN": portableText(input["zh-CN"], `${label} zh-CN`, maximum) }),
  })
}

function localeFallbacks(locale: PortablePluginLocale) {
  const parts = locale.split("-")
  const fallbacks: string[] = []
  while (parts.length > 0) {
    fallbacks.push(parts.join("-"))
    parts.pop()
  }
  return fallbacks
}

/** Exact locale -> parent locale(s) -> declared default locale -> source fallback. */
export function resolvePortablePluginMessage(
  i18n: PortablePluginI18n | undefined,
  localeInput: PortablePluginLocale,
  keyInput: string,
  fallback: string,
) {
  const locale = parsePortablePluginLocale(localeInput)
  const key = parsePortablePluginMessageKey(keyInput)
  if (!i18n) return fallback
  const candidates = [...localeFallbacks(locale), ...localeFallbacks(i18n.defaultLocale)]
  const seen = new Set<string>()
  for (const candidate of candidates) {
    if (seen.has(candidate)) continue
    seen.add(candidate)
    const message = i18n.messages[candidate]?.[key]
    if (message !== undefined) return message
  }
  return fallback
}

export function resolvePortablePluginLocalizedText(
  text: PortablePluginLocalizedText,
  locale: PortablePluginLocale,
  i18n?: PortablePluginI18n,
) {
  const inlineFallback = locale === "zh-CN" ? (text["zh-CN"] ?? text.default) : text.default
  return text.key === undefined ? inlineFallback : resolvePortablePluginMessage(i18n, locale, text.key, inlineFallback)
}

export function resolvePortablePluginName(
  plugin: { readonly i18n?: PortablePluginI18n; readonly name: string },
  locale: PortablePluginLocale,
) {
  return resolvePortablePluginMessage(plugin.i18n, locale, portablePluginReservedMessageKeys.name, plugin.name)
}

export function resolvePortablePluginDescription(
  plugin: { readonly description: string; readonly i18n?: PortablePluginI18n },
  locale: PortablePluginLocale,
) {
  return resolvePortablePluginMessage(
    plugin.i18n,
    locale,
    portablePluginReservedMessageKeys.description,
    plugin.description,
  )
}
