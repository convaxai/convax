import { lstat, readFile } from "node:fs/promises"
import path from "node:path"

import {
  CURRENT_PROTOCOL_DESCRIPTOR_FILE_NAME,
  installCurrentProtocolAuthority,
  parseCurrentProtocolDescriptor,
  type VerifiedProtocolAuthorityV2,
} from "@convax/collaboration"

const maximumDescriptorBytes = 1024 * 1024

export interface CurrentProtocolDescriptorSource {
  loadDescriptorBytes(explicitProtocolRoot: string): Promise<Uint8Array>
}

export interface LoadCurrentCollaborationProtocolOptions {
  /** Absolute packaged/dev staging root; never the repository docs directory. */
  readonly explicitProtocolRoot: string
  readonly source?: CurrentProtocolDescriptorSource
}

/**
 * Loads the one packaged current protocol descriptor and installs the runtime
 * capability it identifies. There is no release pair, pointer, or selector: bytes
 * that differ from the built descriptor fail closed before any decode or sign.
 */
export async function loadCurrentCollaborationProtocol(
  options: LoadCurrentCollaborationProtocolOptions,
): Promise<VerifiedProtocolAuthorityV2> {
  assertExplicitProtocolRoot(options.explicitProtocolRoot)
  const bytes = await (options.source ?? nodeCurrentProtocolDescriptorSource)
    .loadDescriptorBytes(options.explicitProtocolRoot)
  return installCurrentProtocolAuthority(parseCurrentProtocolDescriptor(bytes))
}

export const nodeCurrentProtocolDescriptorSource: CurrentProtocolDescriptorSource = Object.freeze({
  async loadDescriptorBytes(explicitProtocolRoot: string) {
    assertExplicitProtocolRoot(explicitProtocolRoot)
    const root = path.resolve(explicitProtocolRoot)
    const rootStat = await lstat(root)
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
      throw new Error("Current protocol root must be a real directory")
    }
    const descriptorPath = path.join(root, CURRENT_PROTOCOL_DESCRIPTOR_FILE_NAME)
    const descriptorStat = await lstat(descriptorPath)
    if (descriptorStat.isSymbolicLink()) throw new Error("Staged current protocol descriptor is a symlink")
    if (!descriptorStat.isFile()) throw new Error("Staged current protocol descriptor is not a regular file")
    if (descriptorStat.size > maximumDescriptorBytes) {
      throw new Error("Staged current protocol descriptor exceeds its size bound")
    }
    const bytes = new Uint8Array(await readFile(descriptorPath))
    if (bytes.byteLength !== descriptorStat.size) {
      throw new Error("Staged current protocol descriptor changed while reading")
    }
    return bytes
  },
})

function assertExplicitProtocolRoot(explicitProtocolRoot: string): void {
  if (!path.isAbsolute(explicitProtocolRoot) || path.normalize(explicitProtocolRoot) !== explicitProtocolRoot) {
    throw new Error("Current protocol root must be an explicit absolute path without aliases")
  }
}
