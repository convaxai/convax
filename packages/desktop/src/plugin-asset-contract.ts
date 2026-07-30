import {
  requireWebPluginId,
  requireWebPluginRelativePath,
  type ActiveInstalledWebPluginSummary,
} from "./plugin-contracts"

export const webPluginAssetScheme = "convax-plugin"

const digestPattern = /^[a-f0-9]{64}$/
const versionPattern =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/

export interface WebPluginAssetRuntimeIdentity {
  readonly activeRevision: number
  readonly activeSetDigest: string
  readonly pluginId: string
  readonly pluginVersion: string
  readonly snapshotDigest: string
}

export interface ParsedWebPluginAssetUrl {
  readonly identity: WebPluginAssetRuntimeIdentity
  readonly relativePath: string
}

function requireDigest(value: unknown, label: string) {
  if (typeof value !== "string" || !digestPattern.test(value)) {
    throw new Error(`${label} is invalid`)
  }
  return value
}

function requireRevision(value: unknown) {
  if (typeof value !== "string" || !/^[1-9]\d*$/.test(value)) {
    throw new Error("Plugin asset ActiveSet revision is invalid")
  }
  const revision = Number(value)
  if (!Number.isSafeInteger(revision)) throw new Error("Plugin asset ActiveSet revision is invalid")
  return revision
}

function requireVersion(value: unknown) {
  if (typeof value !== "string" || value.length > 256 || !versionPattern.test(value)) {
    throw new Error("Plugin asset version is invalid")
  }
  return value
}

export function webPluginAssetRuntimeIdentity(
  plugin: Pick<
    ActiveInstalledWebPluginSummary,
    "activeRevision" | "activeSetDigest" | "id" | "snapshotDigest" | "version"
  >,
): WebPluginAssetRuntimeIdentity {
  return Object.freeze({
    activeRevision: requireRevision(String(plugin.activeRevision)),
    activeSetDigest: requireDigest(plugin.activeSetDigest, "Plugin asset ActiveSet digest"),
    pluginId: requireWebPluginId(plugin.id),
    pluginVersion: requireVersion(plugin.version),
    snapshotDigest: requireDigest(plugin.snapshotDigest, "Plugin asset snapshot digest"),
  })
}

export function webPluginAssetUrl(
  plugin: Pick<
    ActiveInstalledWebPluginSummary,
    "activeRevision" | "activeSetDigest" | "id" | "snapshotDigest" | "version"
  >,
  relativePathInput: string,
) {
  const identity = webPluginAssetRuntimeIdentity(plugin)
  const relativePath = requireWebPluginRelativePath(relativePathInput, "Plugin asset path")
  const url = new URL(
    `${webPluginAssetScheme}://r${identity.activeRevision}` +
      `.a${identity.activeSetDigest.slice(0, 32)}.a${identity.activeSetDigest.slice(32)}` +
      `.s${identity.snapshotDigest.slice(0, 32)}.s${identity.snapshotDigest.slice(32)}/`,
  )
  url.pathname = [
    identity.pluginId,
    encodeURIComponent(identity.pluginVersion),
    ...relativePath.split("/").map(encodeURIComponent),
  ].join("/")
  return url.href
}

export function parseWebPluginAssetUrl(value: string): ParsedWebPluginAssetUrl {
  const url = new URL(value)
  if (
    url.protocol !== `${webPluginAssetScheme}:` ||
    url.username ||
    url.password ||
    url.port ||
    url.search ||
    url.hash
  ) {
    throw new Error("Plugin asset URL is not supported")
  }
  const host = url.hostname.split(".")
  if (
    host.length !== 5 ||
    !/^r[1-9]\d*$/.test(host[0] ?? "") ||
    !/^a[a-f0-9]{32}$/.test(host[1] ?? "") ||
    !/^a[a-f0-9]{32}$/.test(host[2] ?? "") ||
    !/^s[a-f0-9]{32}$/.test(host[3] ?? "") ||
    !/^s[a-f0-9]{32}$/.test(host[4] ?? "")
  ) {
    throw new Error("Plugin asset URL has no exact runtime origin")
  }
  const segments = url.pathname.slice(1).split("/")
  if (segments.length < 3) {
    throw new Error("Plugin asset URL has no exact runtime identity")
  }
  const pluginId = requireWebPluginId(segments[0])
  let pluginVersion: string
  let relativePath: string
  try {
    pluginVersion = requireVersion(decodeURIComponent(segments[1]!))
    relativePath = requireWebPluginRelativePath(
      segments
        .slice(2)
        .map((segment) => decodeURIComponent(segment))
        .join("/"),
      "Plugin asset path",
    )
  } catch {
    throw new Error("Plugin asset URL is malformed")
  }
  return Object.freeze({
    identity: Object.freeze({
      activeRevision: requireRevision(host[0]!.slice(1)),
      activeSetDigest: requireDigest(
        `${host[1]!.slice(1)}${host[2]!.slice(1)}`,
        "Plugin asset ActiveSet digest",
      ),
      pluginId,
      pluginVersion,
      snapshotDigest: requireDigest(
        `${host[3]!.slice(1)}${host[4]!.slice(1)}`,
        "Plugin asset snapshot digest",
      ),
    }),
    relativePath,
  })
}

export function webPluginAssetBindingForUrl(value: string) {
  try {
    const { identity } = parseWebPluginAssetUrl(value)
    return JSON.stringify([
      identity.pluginId,
      identity.pluginVersion,
      identity.activeRevision,
      identity.activeSetDigest,
      identity.snapshotDigest,
    ])
  } catch {
    return undefined
  }
}

export function webPluginIdForAssetUrl(value: string) {
  try {
    return parseWebPluginAssetUrl(value).identity.pluginId
  } catch {
    return undefined
  }
}
