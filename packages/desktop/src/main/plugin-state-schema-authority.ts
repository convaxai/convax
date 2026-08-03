import { createHash } from "node:crypto"

import { parseDigestV2, type DigestV2, type ValidationArtifactRefV2 } from "@convax/collaboration"
import {
  assertPortablePluginStateValueV1,
  canonicalPortablePluginStateSchemaBytesV1,
  parsePortablePluginStateSchemaV1,
  pluginStateSchemaDigestInputV1,
  portablePluginStateSchemaFormat,
  type PortableBoundedValueSchemaV1,
} from "@convax/plugin-sdk"

import type { PluginPrincipal } from "../plugin-capability-contracts"
import type {
  ActivePluginRuntimeHandle,
  ActivePluginRuntimeSetHandle,
  PluginSnapshotRuntimeIdentity,
} from "./plugin-installation-runtime"

const digestPattern = /^[a-f0-9]{64}$/u

export interface PluginStateSchemaRuntimePort {
  acquireActivePluginSet(): Promise<ActivePluginRuntimeSetHandle>
  acquirePluginSnapshot(identity: PluginSnapshotRuntimeIdentity): Promise<ActivePluginRuntimeHandle>
}

export interface ResolvedPluginStateSchemaV1 {
  readonly exactBytes: Readonly<Uint8Array>
  readonly pluginStateSchemaDigest: DigestV2
  readonly schema: PortableBoundedValueSchemaV1
  readonly validationArtifact: ValidationArtifactRefV2
}

/**
 * Main-private authority for the optional Plugin state dialect.
 *
 * A Plugin renderer never supplies a schema digest or validation-artifact
 * reference. Both are derived from the normalized manifest in the exact
 * immutable closure bound by the Main-issued principal. Exact schema bytes
 * are cached by content identity so the attempt-scoped Canvas fact resolver
 * can consume only a previously admitted artifact.
 */
export class PluginStateSchemaAuthorityV1 {
  readonly #artifacts = new Map<string, Readonly<Uint8Array>>()

  constructor(private readonly runtime: PluginStateSchemaRuntimePort) {}

  async resolvePrincipal(
    principal: PluginPrincipal,
    signal?: AbortSignal,
  ): Promise<ResolvedPluginStateSchemaV1 | null> {
    throwIfAborted(signal)
    const handle = await this.runtime.acquirePluginSnapshot({
      activeRevision: principal.activeRevision,
      activeSetDigest: principal.activeSetDigest,
      pluginId: principal.pluginId,
      pluginVersion: principal.pluginVersion,
      snapshotDigest: principal.snapshotDigest,
    })
    try {
      throwIfAborted(signal)
      return this.#resolveManifestSchema(handle.plugin.contributes.canvas?.renderer?.stateSchema)
    } finally {
      handle.release()
    }
  }

  /** Prime current immutable closures after startup; historical artifacts are admitted on exact-principal use or replication. */
  async primeActive(signal?: AbortSignal): Promise<void> {
    throwIfAborted(signal)
    const active = await this.runtime.acquireActivePluginSet()
    try {
      for (const handle of active.plugins) {
        throwIfAborted(signal)
        this.#resolveManifestSchema(handle.plugin.contributes.canvas?.renderer?.stateSchema)
      }
    } finally {
      active.release()
    }
  }

  /**
   * Admits bytes received from a trusted immutable-blob path. The digest is
   * recomputed from the normalized schema, so transport metadata alone never
   * establishes artifact authority.
   */
  admitExactArtifact(ref: ValidationArtifactRefV2, exactBytesInput: Readonly<Uint8Array>): boolean {
    if (ref.owner !== "plugin" || ref.format !== portablePluginStateSchemaFormat || !digestPattern.test(ref.artifactDigest)) {
      return false
    }
    try {
      const text = new TextDecoder("utf-8", { fatal: true }).decode(exactBytesInput)
      const schema = parsePortablePluginStateSchemaV1(JSON.parse(text))
      const exactBytes = canonicalPortablePluginStateSchemaBytesV1(schema)
      if (!sameBytes(exactBytes, exactBytesInput)) return false
      const digest = stateSchemaDigest(schema)
      if (digest !== ref.artifactDigest) return false
      this.#artifacts.set(digest, new Uint8Array(exactBytes))
      return true
    } catch {
      return false
    }
  }

  resolveArtifact(ref: ValidationArtifactRefV2) {
    if (ref.owner !== "plugin" || ref.format !== portablePluginStateSchemaFormat || !digestPattern.test(ref.artifactDigest)) {
      return Object.freeze({ status: "rejected" as const, code: "artifact-invalid" as const })
    }
    const exactBytes = this.#artifacts.get(ref.artifactDigest)
    if (!exactBytes) return Object.freeze({ status: "pending" as const, ref })
    return Object.freeze({ status: "resolved" as const, ref, exactBytes: new Uint8Array(exactBytes) })
  }

  validateState(authority: ResolvedPluginStateSchemaV1, state: unknown): void {
    assertPortablePluginStateValueV1(authority.schema, state)
  }

  #resolveManifestSchema(value: unknown): ResolvedPluginStateSchemaV1 | null {
    if (value === undefined) return null
    const schema = parsePortablePluginStateSchemaV1(value)
    const exactBytes = canonicalPortablePluginStateSchemaBytesV1(schema)
    const pluginStateSchemaDigest = stateSchemaDigest(schema)
    this.#artifacts.set(pluginStateSchemaDigest, new Uint8Array(exactBytes))
    return Object.freeze({
      exactBytes: new Uint8Array(exactBytes),
      pluginStateSchemaDigest,
      schema,
      validationArtifact: Object.freeze({
        owner: "plugin" as const,
        format: portablePluginStateSchemaFormat,
        artifactDigest: pluginStateSchemaDigest,
      }),
    })
  }
}

function stateSchemaDigest(schema: PortableBoundedValueSchemaV1): DigestV2 {
  return parseDigestV2(createHash("sha256").update(pluginStateSchemaDigestInputV1(schema)).digest("hex"))
}

function sameBytes(left: Readonly<Uint8Array>, right: Readonly<Uint8Array>): boolean {
  if (left.byteLength !== right.byteLength) return false
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) return false
  }
  return true
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw signal.reason ?? new DOMException("The operation was aborted", "AbortError")
}
