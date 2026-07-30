import type {
  MarketplaceDelivery,
  RegistryPackage,
  SourceQualifiedItem,
} from "@convax/marketplace"
import {
  parsePortablePluginManifestV8,
  type PortablePluginManifestV8,
} from "@convax/plugin-sdk"

export type MarketplaceRuntimeSurface = SourceQualifiedItem["runtimeSurface"]

/**
 * Desktop-only presentation policy over the canonical Plugin ABI.
 *
 * The SDK owns syntax and cross-field validation. This adapter receives only a
 * parsed v8 manifest and intentionally projects no execution authority.
 */
export function projectPluginRuntimeSurface(
  manifest: PortablePluginManifestV8,
): MarketplaceRuntimeSurface {
  const contributions = manifest.contributes
  if (
    contributions.canvas !== undefined ||
    contributions.generation !== undefined ||
    contributions.service !== undefined ||
    contributions.pet !== undefined ||
    (contributions.capabilities?.exports.length ?? 0) > 0
  ) {
    return "agent-and-convax"
  }
  if (
    manifest.hooks !== undefined ||
    contributions.agent !== undefined ||
    contributions.llm !== undefined ||
    (contributions.skills?.length ?? 0) > 0
  ) {
    return "agent"
  }
  return "none"
}

/**
 * Network and Packaged Marketplace projections carry protocol-owned manifest
 * bytes. Reparse them through the SDK before deriving any runtime presentation.
 */
export function parsePluginRuntimeSurface(
  value: unknown,
  expectedIdentity?: { readonly id: string; readonly version: string },
): {
  manifest: PortablePluginManifestV8
  runtimeSurface: MarketplaceRuntimeSurface
} {
  const manifest = parsePortablePluginManifestV8(value, { hostApiMode: "runtime" })
  if (
    expectedIdentity !== undefined &&
    (manifest.id !== expectedIdentity.id ||
      manifest.version !== expectedIdentity.version)
  ) {
    throw new TypeError(
      "Plugin manifest identity does not match its Marketplace package",
    )
  }
  return {
    manifest,
    runtimeSurface: projectPluginRuntimeSurface(manifest),
  }
}

export function projectRegistryPackageRuntimeSurface(
  item: Pick<
    RegistryPackage,
    "delivery" | "id" | "kind" | "manifest" | "version"
  >,
): MarketplaceRuntimeSurface {
  if (item.kind === "skill") return "none"
  if (item.kind === "mcp-server") return projectMcpRuntimeSurface(item.delivery)
  if (item.manifest === undefined) {
    throw new TypeError("Plugin Marketplace package is missing its manifest projection")
  }
  return parsePluginRuntimeSurface(item.manifest, item).runtimeSurface
}

export function projectMcpRuntimeSurface(
  delivery: MarketplaceDelivery,
): MarketplaceRuntimeSurface {
  if (delivery.kind === "artifact" || delivery.kind === "builtin-artifact") {
    throw new TypeError("MCP Marketplace package is missing its validated runtime delivery")
  }
  return delivery.kind === "mcp-managed-stdio" &&
    (delivery.extension.productActions?.length ?? 0) > 0
    ? "agent-and-convax"
    : "agent"
}
