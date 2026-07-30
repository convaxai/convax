import { identityKeyForMcpServer, versionKeyForMcpServer } from "@convax/marketplace"

export type MarketplaceReleaseIdentity = {
  kind: "plugin" | "skill" | "mcp-server"
  id: string
  version: string
}

export function releaseTagForPackage(entry: MarketplaceReleaseIdentity): string {
  if (entry.kind === "mcp-server") {
    return `mcp-server-${identityKeyForMcpServer(entry.id).slice(0, 16)}-v${versionKeyForMcpServer(entry.id, entry.version)}`
  }
  const safeSegment = (value: string) => value.replace(/[^A-Za-z0-9._-]/g, "_")
  return `${entry.kind}-${safeSegment(entry.id)}-v${safeSegment(entry.version)}`
}
