import type { InstalledWebPluginSummary } from "../plugin-contracts"
import type {
  InstalledPluginCompanionSnapshot,
  InstalledPluginSnapshot,
  PluginSnapshotByteIdentity,
  PluginSnapshotDigest,
} from "./plugin-installation-snapshot-contracts"

export const pluginInstallationClosureSchema = "convax.plugin-installation-closure/1" as const

export type PluginInstallationRuntimeFaultPoint =
  | "closure.file-written"
  | "closure.renamed-before-pointer"
  | "closure.validated-before-pointer"

export interface PluginInstallationRuntimeOptions {
  readonly faultHook?: (
    point: PluginInstallationRuntimeFaultPoint,
    context: { pluginId: string; snapshotDigest: PluginSnapshotDigest },
  ) => Promise<void> | void
  readonly retiredSourceMigrations?: readonly RetiredPluginSourceMigration[]
}

export interface RetiredPluginSourceMigration {
  readonly fromSourceIdentity: string
  readonly pluginId: string
  readonly toSourceIdentity: string
}

export interface PluginInstallationCandidateCompanion {
  readonly bytes: Uint8Array
  readonly entryPath: string
  readonly mode: InstalledPluginCompanionSnapshot["mode"]
  readonly target: string
}

export interface PluginExecutionAuthorizationSelection {
  readonly companion: boolean
  readonly hook: boolean
}

export interface PluginInstallationCandidate {
  /**
   * Exact archive identity already verified by the delivery owner. The
   * immutable extracted tree is independently re-hashed before activation.
   */
  readonly artifact: PluginSnapshotByteIdentity
  readonly companion?: PluginInstallationCandidateCompanion
  /**
   * Explicit install-time consent. The runtime derives the binding digests
   * from the exact immutable bytes; callers cannot supply an arbitrary digest.
   */
  readonly executionAuthorization?: Partial<PluginExecutionAuthorizationSelection>
  readonly files: Readonly<Record<string, string | Uint8Array>>
  /** Canonical Marketplace SourceKey digest, not a URL or display id. */
  readonly sourceIdentity: PluginSnapshotDigest
}

export interface ActivePluginRuntimeIdentity {
  readonly activeRevision: number
  readonly activeSetDigest: PluginSnapshotDigest
  readonly pluginId: string
  readonly snapshotDigest: PluginSnapshotDigest
  readonly version: string
}

export interface PluginSnapshotRuntimeIdentity {
  readonly activeRevision: number
  readonly activeSetDigest: PluginSnapshotDigest
  readonly pluginId: string
  readonly pluginVersion: string
  readonly snapshotDigest: PluginSnapshotDigest
}

export interface ActiveInstalledPlugin {
  readonly identity: ActivePluginRuntimeIdentity
  readonly plugin: InstalledWebPluginSummary
}

export interface ActivePluginRuntimeSelection {
  readonly activeSetDigest: PluginSnapshotDigest | null
  readonly plugins: readonly ActiveInstalledPlugin[]
  readonly revision: number
}

export interface ActivePluginRuntimeSetHandle extends ActivePluginRuntimeSelection {
  readonly plugins: readonly ActivePluginRuntimeHandle[]
  readonly released: boolean
  release(): void
}

export interface ActivePluginRuntimeHandle extends ActiveInstalledPlugin {
  readonly descriptor: InstalledPluginSnapshot["descriptor"]
  readonly released: boolean
  release(): void
  resolveAsset(relativePath: string): Promise<string>
  resolveCompanion(): Promise<string | null>
  resolveHook(): Promise<string | null>
  resolveOwnedSkillDirectory(skillName: string): Promise<string>
  resolveOwnedSkillFile(skillName: string, relativePath: string): Promise<string>
}

export interface ActivePluginSetCallLease {
  readonly activeRevision: number
  readonly activeSetDigest: PluginSnapshotDigest
  readonly callerSnapshotDigest: PluginSnapshotDigest
  readonly providerSnapshotDigest: PluginSnapshotDigest
  readonly released: boolean
  release(): void
}

export interface ActivePluginCapabilityIdentity {
  /** Compatibility alias for `manifestDigest` during the principal cutover. */
  readonly digest: PluginSnapshotDigest
  readonly activeRevision: number
  readonly activeSetDigest: PluginSnapshotDigest
  readonly manifestDigest: PluginSnapshotDigest
  readonly plugin: InstalledWebPluginSummary
  readonly snapshotDigest: PluginSnapshotDigest
}

export class PluginInstallationRuntimeError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = "PluginInstallationRuntimeError"
  }
}

export class PluginExecutionSetupRequiredError extends PluginInstallationRuntimeError {
  readonly pluginId: string
  readonly surface: "companion" | "hook"

  constructor(pluginId: string, surface: "companion" | "hook") {
    super(`Plugin ${surface} is installed but not authorized; setup is required: ${pluginId}`)
    this.name = "PluginExecutionSetupRequiredError"
    this.pluginId = pluginId
    this.surface = surface
  }
}

export class PluginNotActiveError extends PluginInstallationRuntimeError {
  readonly pluginId: string

  constructor(pluginId: string) {
    super(`Plugin is not active: ${pluginId}`)
    this.name = "PluginNotActiveError"
    this.pluginId = pluginId
  }
}

export function pluginInstallationRuntimeError(message: string, cause?: unknown) {
  return new PluginInstallationRuntimeError(message, cause === undefined ? undefined : { cause })
}
