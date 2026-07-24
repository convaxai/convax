import { pathToFileURL } from "node:url"

import { customPetIdPattern } from "./custom-pet-store"

export const petAssetScheme = "convax-pet-asset"
export const petAssetPrivileges = {
  corsEnabled: true,
  secure: true,
  standard: true,
  stream: true,
  supportFetchAPI: true,
} as const

export function petAssetIdForUrl(value: string) {
  try {
    const url = new URL(value)
    if (
      url.protocol !== `${petAssetScheme}:` ||
      url.hostname !== "pet" ||
      url.username ||
      url.password ||
      url.port ||
      url.search ||
      url.hash
    ) {
      return null
    }
    const match = /^\/([^/]+)$/.exec(url.pathname)
    if (!match) return null
    const id = decodeURIComponent(match[1]!)
    return customPetIdPattern.test(id) && id.length <= 80 ? id : null
  } catch {
    return null
  }
}

interface PetAssetResolver {
  resolveAsset(id: string): Promise<string>
}

type PetAssetFetch = (url: string, init: { headers: Headers }) => Promise<Response>

export function createPetAssetHandler(resolver: PetAssetResolver, fetchFile: PetAssetFetch) {
  return async (request: Request) => {
    const id = petAssetIdForUrl(request.url)
    if (!id) return new Response("Pet asset was not found", { status: 404 })
    try {
      const file = await resolver.resolveAsset(id)
      return await fetchFile(pathToFileURL(file).href, { headers: request.headers })
    } catch {
      return new Response("Pet asset was not found", { status: 404 })
    }
  }
}
