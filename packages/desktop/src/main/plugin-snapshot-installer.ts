import { createHash } from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"

import {
  compareWebPluginVersions,
  parseWebPluginManifest,
  requireWebPluginRelativePath,
  toInstalledWebPluginSummary,
  webPluginManifestFileName,
  webPluginManifestSchemaV8,
  type InstalledWebPluginSummary,
} from "../plugin-contracts"
import { assertSelfContainedHookModule } from "./plugin-hook-module-validator"
import {
  PluginInstallationRuntime,
  type PluginInstallationCandidate,
  type PluginInstallationCandidateCompanion,
} from "./plugin-installation-runtime"

const bunCompanionHeader = Buffer.from("#!/usr/bin/env convax-bun\n")
const maximumLocalEntries = 4_096

export interface PluginSnapshotCompanionCandidate {
  readonly bytes: Uint8Array
  readonly command: string
  readonly target: string
}

export interface PluginSnapshotPublication {
  readonly artifact: { readonly sha256: string; readonly size: number }
  readonly authorizeExecution: boolean
  readonly companion?: PluginSnapshotCompanionCandidate
  readonly files: Readonly<Record<string, string | Uint8Array>>
  readonly sourceIdentity: string
}

export interface PluginSnapshotInstallOptions {
  readonly allowCurrent?: boolean
  readonly requireInstalled?: boolean
}

function sha256(bytes: Uint8Array | string) {
  return createHash("sha256").update(bytes).digest("hex")
}

function bytes(value: string | Uint8Array) {
  return typeof value === "string" ? Buffer.from(value, "utf8") : Buffer.from(value)
}

function manifestFromFiles(files: Readonly<Record<string, string | Uint8Array>>) {
  const document = files[webPluginManifestFileName]
  if (document === undefined) throw new Error("Plugin package is missing manifest.json")
  const plugin = toInstalledWebPluginSummary(
    parseWebPluginManifest(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes(document)))),
  )
  if (plugin.schema !== webPluginManifestSchemaV8) {
    throw new Error(`Plugin installation requires ${webPluginManifestSchemaV8}: ${plugin.id}`)
  }
  return plugin
}

function companionCandidate(
  plugin: InstalledWebPluginSummary,
  candidate: PluginSnapshotCompanionCandidate | undefined,
): PluginInstallationCandidateCompanion | undefined {
  if (!plugin.runtime) {
    if (candidate) throw new Error(`Plugin without a local runtime cannot install a companion: ${plugin.id}`)
    return undefined
  }
  if (!candidate) {
    throw new Error(`Executable Plugin requires a verified immutable companion: ${plugin.id}`)
  }
  if (candidate.command !== plugin.runtime.command) {
    throw new Error(`Plugin companion command does not match its manifest runtime: ${plugin.id}`)
  }
  const companionBytes = bytes(candidate.bytes)
  return {
    bytes: companionBytes,
    entryPath: requireWebPluginRelativePath(candidate.command, "Plugin companion command"),
    mode: companionBytes.subarray(0, bunCompanionHeader.length).equals(bunCompanionHeader)
      ? "convax-bun"
      : "native",
    target: candidate.target,
  }
}

async function validateExecutableContributions(
  plugin: InstalledWebPluginSummary,
  files: Readonly<Record<string, string | Uint8Array>>,
) {
  if (!plugin.hooks) return
  const hook = files[plugin.hooks]
  if (hook === undefined) throw new Error(`Plugin Hook is missing from its package: ${plugin.id}`)
  await assertSelfContainedHookModule(bytes(hook), "Plugin Hook module")
}

/**
 * Main installation application service. Delivery adapters provide verified
 * bytes and a canonical SourceKey; this service admits one complete v8 closure
 * and changes only the global ActiveSet CAS.
 */
export class PluginSnapshotInstaller {
  readonly #runtime: PluginInstallationRuntime

  constructor(runtime: PluginInstallationRuntime) {
    this.#runtime = runtime
  }

  async install(publication: PluginSnapshotPublication, options: PluginSnapshotInstallOptions = {}) {
    const plugin = manifestFromFiles(publication.files)
    await validateExecutableContributions(plugin, publication.files)
    const companion = companionCandidate(plugin, publication.companion)
    const current = await this.#runtime.readActive()
    const installed = current.plugins.find((candidate) => candidate.plugin.id === plugin.id)
    if (options.requireInstalled && !installed) {
      throw new Error(`Plugin update requires an installed Plugin: ${plugin.id}`)
    }
    if (installed) {
      const comparison = compareWebPluginVersions(plugin.version, installed.plugin.version)
      if (comparison < 0) throw new Error(`Installed Plugin is newer than the candidate: ${plugin.id}`)
      if (comparison === 0 && !options.allowCurrent) {
        throw new Error(`Plugin update must have a newer version: ${plugin.id}`)
      }
    }
    const candidate: PluginInstallationCandidate = {
      artifact: { ...publication.artifact },
      ...(companion ? { companion } : {}),
      executionAuthorization: {
        companion: publication.authorizeExecution && companion !== undefined,
        hook: publication.authorizeExecution && plugin.hooks !== undefined,
      },
      files: publication.files,
      sourceIdentity: publication.sourceIdentity,
    }
    const next = await this.#runtime.publish(current.revision, candidate)
    const result = next.plugins.find((candidate) => candidate.plugin.id === plugin.id)?.plugin
    if (!result) throw new Error(`Plugin activation did not publish its candidate: ${plugin.id}`)
    return result
  }

  async uninstall(pluginId: string) {
    const current = await this.#runtime.readActive()
    return this.#runtime.uninstall(current.revision, pluginId)
  }

  async installLocalDirectory(
    directory: string,
    input: Pick<PluginSnapshotPublication, "authorizeExecution" | "sourceIdentity">,
    options: PluginSnapshotInstallOptions = {},
  ) {
    const root = await fs.realpath(directory)
    const rootInfo = await fs.lstat(root)
    if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) {
      throw new Error("Local Plugin snapshot must be a real directory")
    }
    const files: Record<string, Uint8Array> = {}
    const visit = async (current: string, prefix = ""): Promise<void> => {
      const entries = await fs.readdir(current, { withFileTypes: true })
      for (const entry of entries) {
        if (entry.isSymbolicLink()) throw new Error("Local Plugin snapshot cannot contain symbolic links")
        const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name
        requireWebPluginRelativePath(relativePath, "Local Plugin path")
        const target = path.join(current, entry.name)
        if (entry.isDirectory()) await visit(target, relativePath)
        else if (entry.isFile()) files[relativePath] = await fs.readFile(target)
        else throw new Error("Local Plugin snapshot contains an unsupported filesystem entry")
        if (Object.keys(files).length > maximumLocalEntries) {
          throw new Error("Local Plugin snapshot exceeds its file-count limit")
        }
      }
    }
    await visit(root)
    const identities = Object.entries(files)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([relativePath, value]) => [relativePath, value.byteLength, sha256(value)])
    const artifactDocument = JSON.stringify(identities)
    return this.install(
      {
        artifact: { sha256: sha256(artifactDocument), size: Buffer.byteLength(artifactDocument) },
        authorizeExecution: input.authorizeExecution,
        files,
        sourceIdentity: input.sourceIdentity,
      },
      options,
    )
  }
}
