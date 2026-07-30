import type { MarketplaceState } from "./marketplace-state"

export function isMarketplacePluginRuntimeAdmitted(input: {
  authorizationContractDigest: string | null
  pluginId: string
  pluginVersion: string
  state: MarketplaceState | undefined
}) {
  const { authorizationContractDigest, pluginId, pluginVersion, state } = input
  if (!state || !authorizationContractDigest) return false
  const installed = state.installations.find((record) => record.kind === "plugin" && record.id === pluginId)
  if (!installed || installed.version !== pluginVersion) return false
  if (state.transitions.some((transition) => transition.identity.kind === "plugin" && transition.identity.id === pluginId)) {
    return false
  }
  const grant = state.executionGrants.find(
    (record) =>
      record.identity.kind === "plugin" && record.identity.id === pluginId && record.sourceKey === installed.sourceKey,
  )
  const preference = state.runtimePreferences.find(
    (record) =>
      record.identity.kind === "plugin" && record.identity.id === pluginId && record.sourceKey === installed.sourceKey,
  )
  return Boolean(
    grant && grant.authorizationContractDigest === authorizationContractDigest && preference?.desired !== "disabled",
  )
}
