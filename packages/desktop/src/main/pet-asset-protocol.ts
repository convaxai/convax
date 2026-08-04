import { parse as parseConvaxUri } from "@convax/uri"
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
    const uri = parseConvaxUri(value)
    if (uri.scheme !== petAssetScheme || uri.authority !== "pet" || uri.query || uri.fragment) {
      return null
    }
    if (uri.pathSegments.length !== 1 || uri.pathSegments[0]!.includes("/")) return null
    const id = uri.pathSegments[0]!
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
