import { pathToFileURL } from "node:url"

export const petAssetScheme = "convax-pet-asset"
export const petAssetPrivileges = {
  corsEnabled: true,
  secure: true,
  standard: true,
  stream: true,
  supportFetchAPI: true,
} as const

const pluginPetIdPattern = /^plugin:[a-z0-9]+(?:-[a-z0-9]+)*$/
const customPetIdPattern = /^custom:[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/

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
    return pluginPetIdPattern.test(id) || customPetIdPattern.test(id) ? id : null
  } catch {
    return null
  }
}

interface PetAssetResolver {
  resolvePetAsset(id: string): Promise<string>
}

type PetAssetFetch = (url: string, init: { headers: Headers }) => Promise<Response>

export function createPetAssetHandler(resolver: PetAssetResolver, fetchFile: PetAssetFetch) {
  return async (request: Request) => {
    const id = petAssetIdForUrl(request.url)
    if (!id) return new Response("Pet asset was not found", { status: 404 })
    try {
      const file = await resolver.resolvePetAsset(id)
      return await fetchFile(pathToFileURL(file).href, { headers: request.headers })
    } catch {
      return new Response("Pet asset was not found", { status: 404 })
    }
  }
}
