/**
 * Stable public facade for Plugin installation snapshot contracts and the
 * atomic filesystem state store. Runtime coordination and immutable closure
 * bytes intentionally live in separate modules.
 */
export * from "./plugin-installation-snapshot-contracts"
export { PluginInstallationSnapshotStore } from "./plugin-installation-snapshot-state-store"
