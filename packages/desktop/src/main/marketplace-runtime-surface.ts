import type {
  MarketplaceDelivery,
  MarketplacePluginCategory,
  RegistryPackage,
  SourceQualifiedItem,
} from "@convax/marketplace"
import { parsePortablePluginManifest, type PortablePluginManifest } from "@convax/plugin-sdk"

export type MarketplaceRuntimeSurface = SourceQualifiedItem["runtimeSurface"]

export interface MarketplaceCatalogRuntimeProjection {
  readonly pluginCategories: readonly MarketplacePluginCategory[]
  readonly runtimeSurface: MarketplaceRuntimeSurface
}

const noPluginCategories = Object.freeze([]) as readonly MarketplacePluginCategory[]

/**
 * Derives one bounded display taxonomy from the exact validated contribution set.
 * The result is presentation metadata only and never substitutes for live runtime
 * or authorization checks.
 */
export function projectPluginCategories(manifest: PortablePluginManifest): readonly MarketplacePluginCategory[] {
  const contributions = manifest.contributes
  const serviceContributions = "services" in contributions ? (contributions.services ?? []) : []
  const outputs = new Set([
    ...(contributions.generation?.tools.map((tool) => tool.output) ?? []),
    ...serviceContributions.flatMap((service) => service.generation?.tools.map((tool) => tool.output) ?? []),
  ])
  const categories: MarketplacePluginCategory[] = []
  if (("service" in contributions && contributions.service !== undefined) || serviceContributions.length > 0) {
    categories.push("service")
  }
  if (outputs.has("video")) categories.push("video")
  if (outputs.has("image")) categories.push("image")
  if ((contributions.skills?.length ?? 0) > 0) categories.push("skill")
  return Object.freeze(categories)
}

/**
 * Desktop-only presentation policy over the canonical Plugin ABI.
 *
 * The SDK owns syntax and cross-field validation. This adapter receives only a
 * parsed released manifest and intentionally projects no execution authority.
 */
export function projectPluginRuntimeSurface(manifest: PortablePluginManifest): MarketplaceRuntimeSurface {
  const contributions = manifest.contributes
  if (
    contributions.canvas !== undefined ||
    contributions.generation !== undefined ||
    ("service" in contributions && contributions.service !== undefined) ||
    ("services" in contributions && (contributions.services?.length ?? 0) > 0) ||
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
  manifest: PortablePluginManifest
  pluginCategories: readonly MarketplacePluginCategory[]
  runtimeSurface: MarketplaceRuntimeSurface
} {
  const manifest = parsePortablePluginManifest(value, { hostApiMode: "runtime" })
  if (
    expectedIdentity !== undefined &&
    (manifest.id !== expectedIdentity.id || manifest.version !== expectedIdentity.version)
  ) {
    throw new TypeError("Plugin manifest identity does not match its Marketplace package")
  }
  return {
    manifest,
    pluginCategories: projectPluginCategories(manifest),
    runtimeSurface: projectPluginRuntimeSurface(manifest),
  }
}

export function projectRegistryPackageRuntimeProjection(
  item: Pick<RegistryPackage, "delivery" | "id" | "kind" | "manifest" | "version">,
): MarketplaceCatalogRuntimeProjection {
  if (item.kind === "skill") {
    return { pluginCategories: noPluginCategories, runtimeSurface: "none" }
  }
  if (item.kind === "mcp-server") {
    return {
      pluginCategories: noPluginCategories,
      runtimeSurface: projectMcpRuntimeSurface(item.delivery),
    }
  }
  if (item.manifest === undefined) {
    throw new TypeError("Plugin Marketplace package is missing its manifest projection")
  }
  const projected = parsePluginRuntimeSurface(item.manifest, item)
  return {
    pluginCategories: projected.pluginCategories,
    runtimeSurface: projected.runtimeSurface,
  }
}

export function projectMcpRuntimeSurface(delivery: MarketplaceDelivery): MarketplaceRuntimeSurface {
  if (delivery.kind === "artifact" || delivery.kind === "builtin-artifact") {
    throw new TypeError("MCP Marketplace package is missing its validated runtime delivery")
  }
  return delivery.kind === "mcp-managed-stdio" && (delivery.extension.productActions?.length ?? 0) > 0
    ? "agent-and-convax"
    : "agent"
}
