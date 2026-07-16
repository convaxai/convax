import fs from "node:fs/promises"
import { extname } from "node:path"

import { requireWebPluginId, requireWebPluginRelativePath } from "../plugin-contracts"
import type { WebPluginManager } from "./plugin-manager"

export const webPluginAssetScheme = "convax-plugin"

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
  resolveAsset(pluginId: string, relativePath: string): Promise<string>
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

function responseHeaders(relativePath: string, rendererUrl: string) {
  const frameAncestor = pluginFrameAncestorSource(rendererUrl)
  return {
    "Cache-Control": "no-store",
    "Content-Security-Policy": [
      "default-src 'none'",
      "script-src 'self'",
      "style-src 'self'",
      "img-src 'self' data: blob:",
      "media-src 'self' data: blob:",
      "font-src 'self' data:",
      "connect-src 'none'",
      "worker-src 'none'",
      "child-src 'none'",
      "frame-src 'none'",
      "object-src 'none'",
      "base-uri 'none'",
      "form-action 'none'",
      `frame-ancestors ${frameAncestor}`,
    ].join("; "),
    "Content-Type": pluginAssetContentType(relativePath),
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
  }
}

function parsePluginAssetUrl(value: string) {
  const url = new URL(value)
  if (url.protocol !== `${webPluginAssetScheme}:`
    || url.username
    || url.password
    || url.port
    || url.search
    || url.hash) {
    throw new Error("Plugin asset URL is not supported")
  }
  const pluginId = requireWebPluginId(url.hostname)
  const relativePath = requireWebPluginRelativePath(
    decodeURIComponent(url.pathname.slice(1)),
    "Plugin asset path",
  )
  return { pluginId, relativePath }
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
 * can be tested directly. Package lookup always goes through WebPluginManager.
 */
export function createWebPluginAssetHandler(
  manager: Pick<WebPluginManager, "resolveAsset"> | WebPluginAssetResolver,
  options: WebPluginAssetHandlerOptions,
) {
  const rendererUrl = options.rendererUrl
  // Validate once during composition instead of failing individual asset requests.
  pluginFrameAncestorSource(rendererUrl)

  return async (request: Pick<Request, "url">): Promise<Response> => {
    try {
      const { pluginId, relativePath } = parsePluginAssetUrl(request.url)
      const absolutePath = await manager.resolveAsset(pluginId, relativePath)
      const content = await readResolvedAsset(absolutePath)
      return new Response(content, { headers: responseHeaders(relativePath, rendererUrl), status: 200 })
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
