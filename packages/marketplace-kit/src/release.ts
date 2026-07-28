import { identityKeyForMcpServer, legacyPackageReleaseTag, versionKeyForMcpServer } from "@convax/marketplace"

export type MarketplaceReleaseIdentity = {
  kind: "plugin" | "skill" | "mcp-server"
  id: string
  version: string
}

export function releaseTagForPackage(entry: MarketplaceReleaseIdentity): string {
  if (entry.kind === "mcp-server") {
    return `mcp-server-${identityKeyForMcpServer(entry.id).slice(0, 16)}-v${versionKeyForMcpServer(entry.id, entry.version)}`
  }
  return legacyPackageReleaseTag({ kind: entry.kind, id: entry.id, version: entry.version })
}
