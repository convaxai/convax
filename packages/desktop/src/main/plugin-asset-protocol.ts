import fs from "node:fs/promises"
import { extname } from "node:path"
import {
  getPluginApiDefinition,
  isPluginApiDeclared,
  type PluginApiDeclaration,
  type PluginApiId,
} from "@convax/plugin-api"

import {
  parseWebPluginAssetUrl,
  webPluginAssetBindingForUrl,
  webPluginAssetScheme,
  type WebPluginAssetRuntimeIdentity,
} from "../plugin-asset-contract"
import type { WebPluginPetContribution } from "../plugin-contracts"

export { webPluginAssetScheme } from "../plugin-asset-contract"

export const webPluginAssetPrivileges = {
  corsEnabled: true,
  secure: true,
  standard: true,
  stream: true,
  supportFetchAPI: true,
} as const

const maxServedAssetBytes = 16 * 1024 * 1024

const contentTypeByExtension: Readonly<Record<string, string>> = {
  ".avif": "image/avif",
  ".bin": "application/octet-stream",
  ".css": "text/css; charset=utf-8",
  ".gif": "image/gif",
  ".glb": "model/gltf-binary",
  ".gltf": "model/gltf+json",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".mp3": "audio/mpeg",
  ".mp4": "video/mp4",
  ".ogg": "audio/ogg",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".wav": "audio/wav",
  ".webm": "video/webm",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
}

export interface WebPluginAssetResolver {
  acquirePluginSnapshot(identity: WebPluginAssetRuntimeIdentity): Promise<{
    identity: {
      activeRevision: number
      activeSetDigest: string
      pluginId: string
      snapshotDigest: string
      version: string
    }
    plugin: {
      capabilities: readonly string[]
      contributes?: {
        readonly pet?: WebPluginPetContribution
      }
      hostApi?: PluginApiDeclaration
      id: string
      schema: string
    }
    release(): void
    resolveAsset(relativePath: string): Promise<string>
  }>
}

export interface WebPluginAssetHandlerOptions {
  /** The only top-level renderer allowed to frame Plugin documents. */
  rendererUrl: string
}

export function pluginFrameAncestorSource(rendererUrl: string) {
  const url = new URL(rendererUrl)
  if (url.protocol === "file:") return "file:"
  if (url.protocol === "http:" || url.protocol === "https:") return `${url.protocol}//${url.host}`
  return "'none'"
}

export function pluginAssetContentType(relativePath: string) {
  return contentTypeByExtension[extname(relativePath).toLowerCase()] ?? "application/octet-stream"
}

interface WebPluginCspProjection {
  connectedImages: boolean
  connectedStreams: boolean
  petAssets: boolean
}

function responseHeaders(
  relativePath: string,
  rendererUrl: string,
  projection: WebPluginCspProjection = {
    connectedImages: false,
    connectedStreams: false,
    petAssets: false,
  },
) {
  const frameAncestor = pluginFrameAncestorSource(rendererUrl)
  const imageSources = [
    "'self'",
    "data:",
    "blob:",
    ...(projection.connectedImages ? ["convax-connected-media:"] : []),
    ...(projection.petAssets ? ["convax-pet-asset:"] : []),
  ].join(" ")
  const mediaSources = [
    "'self'",
    "data:",
    "blob:",
    ...(projection.connectedStreams ? ["convax-connected-media:"] : []),
  ].join(" ")
  return {
    "Cache-Control": "no-store",
    "Content-Security-Policy": [
      "default-src 'none'",
      "script-src 'self'",
      "style-src 'self'",
      `img-src ${imageSources}`,
      `media-src ${mediaSources}`,
      "font-src 'self' data:",
      "connect-src 'none'",
      "worker-src 'none'",
      "child-src 'none'",
      "frame-src 'none'",
      "object-src 'none'",
      "base-uri 'none'",
      "form-action 'none'",
      "navigate-to 'self'",
      `frame-ancestors ${frameAncestor}`,
    ].join("; "),
    "Content-Type": pluginAssetContentType(relativePath),
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
  }
}

export function webPluginIdForAssetUrl(value: string) {
  try {
    return parseWebPluginAssetUrl(value).identity.pluginId
  } catch {
    return undefined
  }
}

/** Resolve the immutable Plugin binding before deciding a subframe navigation. */
export function webPluginFrameBindingForNavigation(currentUrl: string, nextUrl: string, boundIdentity?: string) {
  if (boundIdentity) return boundIdentity
  const currentIdentity = webPluginAssetBindingForUrl(currentUrl)
  if (currentIdentity) return currentIdentity
  if (currentUrl === "" || currentUrl === "about:blank") return webPluginAssetBindingForUrl(nextUrl)
  return undefined
}

/** Keep a bound Plugin frame on one exact immutable runtime generation. */
export function isAllowedWebPluginFrameNavigation(currentUrl: string, nextUrl: string, boundIdentity?: string) {
  const nextIdentity = webPluginAssetBindingForUrl(nextUrl)
  if (!nextIdentity) return false
  if (boundIdentity !== undefined) return boundIdentity === nextIdentity
  if (currentUrl === "about:blank") return true
  return webPluginAssetBindingForUrl(currentUrl) === nextIdentity
}

async function readResolvedAsset(absolutePath: string) {
  const noFollow = fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0)
  const handle = await fs.open(absolutePath, noFollow)
  try {
    const stat = await handle.stat()
    if (!stat.isFile() || stat.size > maxServedAssetBytes) throw new Error("Plugin asset is not a supported file")
    const content = await handle.readFile()
    if (content.byteLength > maxServedAssetBytes) throw new Error("Plugin asset exceeds the served size limit")
    return new Uint8Array(content)
  } finally {
    await handle.close()
  }
}

/**
 * Build a protocol handler without importing Electron so the native trust boundary
 * can be tested directly. Asset bytes are read while the exact ActiveSet lease
 * remains held; a naked native path is never returned across this boundary.
 */
export function createWebPluginAssetHandler(manager: WebPluginAssetResolver, options: WebPluginAssetHandlerOptions) {
  const rendererUrl = options.rendererUrl
  // Validate once during composition instead of failing individual asset requests.
  pluginFrameAncestorSource(rendererUrl)

  return async (request: Pick<Request, "url">): Promise<Response> => {
    try {
      const { identity, relativePath } = parseWebPluginAssetUrl(request.url)
      const active = await manager.acquirePluginSnapshot(identity)
      try {
        if (
          active.identity.activeRevision !== identity.activeRevision ||
          active.identity.activeSetDigest !== identity.activeSetDigest ||
          active.identity.pluginId !== identity.pluginId ||
          active.identity.snapshotDigest !== identity.snapshotDigest ||
          active.identity.version !== identity.pluginVersion ||
          active.plugin.id !== identity.pluginId
        ) {
          throw new Error("Plugin asset resolver returned another runtime generation")
        }
        const absolutePath = await active.resolveAsset(relativePath)
        const projection = {
          connectedImages: declaresAuthorizedHostApi(active.plugin, "canvas.inputs.image.open"),
          connectedStreams: declaresAuthorizedHostApi(active.plugin, "canvas.inputs.open"),
          petAssets: declaresAuthorizedPetAssetSurface(active.plugin, relativePath),
        }
        const content = await readResolvedAsset(absolutePath)
        return new Response(content, {
          headers: responseHeaders(relativePath, rendererUrl, projection),
          status: 200,
        })
      } finally {
        active.release()
      }
    } catch {
      return new Response("Plugin asset was not found", {
        headers: {
          "Cache-Control": "no-store",
          "Content-Type": "text/plain; charset=utf-8",
          "X-Content-Type-Options": "nosniff",
        },
        status: 404,
      })
    }
  }
}

function declaresAuthorizedHostApi(
  plugin: {
    capabilities: readonly string[]
    hostApi?: PluginApiDeclaration
    schema: string
  },
  apiId: PluginApiId,
) {
  if (plugin.schema !== "convax.plugin/8" || !plugin.hostApi || !isPluginApiDeclared(plugin.hostApi, apiId)) {
    return false
  }
  const grant = getPluginApiDefinition(apiId).grant
  return grant === null || plugin.capabilities.includes(grant)
}

function declaresAuthorizedPetAssetSurface(
  plugin: {
    capabilities: readonly string[]
    contributes?: {
      readonly pet?: WebPluginPetContribution
    }
    schema: string
  },
  relativePath: string,
) {
  if (plugin.schema !== "convax.plugin/8" || !plugin.capabilities.includes("pet.custom.manage")) {
    return false
  }
  const contribution = plugin.contributes?.pet
  return (
    contribution?.protocol === "convax.pet-host/1" &&
    (relativePath === contribution.overlay || relativePath === contribution.settings)
  )
}
