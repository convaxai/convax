import type { MarketplaceDescriptor, MarketplaceProductPolicy } from "@convax/marketplace"

export function assertCanonicalOfficialMarketplaceDescriptor(
  descriptor: MarketplaceDescriptor,
  policy: MarketplaceProductPolicy["official"],
) {
  const [owner, repository, ...extra] = policy.repository.split("/")
  const descriptorUrl = new URL(policy.descriptorUrl)
  const pagesRoot = new URL("./", descriptorUrl).toString()
  if (
    !owner ||
    !repository ||
    extra.length > 0 ||
    descriptor.id !== policy.marketplaceId ||
    descriptor.repository.owner !== owner ||
    descriptor.repository.name !== repository ||
    descriptor.registry.v2.url !== new URL("registry/v2/index.json", pagesRoot).toString() ||
    descriptor.showcase.v2.url !== new URL("showcase/v2/index.json", pagesRoot).toString()
  ) {
    throw new Error("Official Marketplace descriptor does not match the canonical product source identity")
  }
}
