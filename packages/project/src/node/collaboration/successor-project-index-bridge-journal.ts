import fs from "node:fs/promises"
import path from "node:path"
import {
  decodeRestrictedJcsV2,
  parseDigestV2,
  parseLocalOwnerEditAuthorizationV3,
  parseProtocolPromotionBridgeV3,
  type DigestV2,
  type LocalOwnerEditAuthorizationV3,
  type ProtocolPromotionBridgeV3,
} from "@convax/collaboration"
import type { SuccessorGenesisEvidenceV3 } from "./successor-local-project-provisioner"

export interface SuccessorProjectIndexBridgeJournalV3 {
  readonly claimDigest: DigestV2
  readonly ownerBindingCoreDigest: DigestV2
  readonly authorization: LocalOwnerEditAuthorizationV3
  readonly genesis: SuccessorGenesisEvidenceV3
  readonly bridge: ProtocolPromotionBridgeV3
}

export class NodeSuccessorProjectIndexBridgeJournalSourceV3 {
  constructor(private readonly projectPrivateDirectory: string) {
    if (!path.isAbsolute(projectPrivateDirectory) || path.resolve(projectPrivateDirectory) !== projectPrivateDirectory) {
      throw new TypeError("Project private directory must be canonical and absolute")
    }
  }

  async resolveExact(claimDigestInput: DigestV2): Promise<SuccessorProjectIndexBridgeJournalV3 | "missing" | "rejected"> {
    const claimDigest = parseDigestV2(claimDigestInput)
    try {
      const target = path.join(this.projectPrivateDirectory, "protocol-v3", "project-index-bridge-journal.jcs")
      const stat = await fs.lstat(target)
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 1 || stat.size > 512 * 1024) return "rejected"
      const value = decodeRestrictedJcsV2(new Uint8Array(await fs.readFile(target)))
      if (!value || typeof value !== "object" || Array.isArray(value)) return "rejected"
      const source = value as Record<string, unknown>
      const keys = Object.keys(source).sort()
      const expected = ["authorization", "bridge", "claimDigest", "format", "genesis", "ownerBindingCoreDigest"].sort()
      if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) return "rejected"
      if (source.format !== "convax.project-index-promotion-bridge-journal/3" || parseDigestV2(source.claimDigest) !== claimDigest) return "rejected"
      const genesis = source.genesis as SuccessorGenesisEvidenceV3
      return Object.freeze({
        claimDigest,
        ownerBindingCoreDigest: parseDigestV2(source.ownerBindingCoreDigest),
        authorization: parseLocalOwnerEditAuthorizationV3(source.authorization),
        genesis: Object.freeze({
          authorizationProofDigest: parseDigestV2(genesis.authorizationProofDigest),
          durableCheckpointDigest: parseDigestV2(genesis.durableCheckpointDigest),
          acceptedHeadDigest: parseDigestV2(genesis.acceptedHeadDigest),
          acceptedFrontierDigest: parseDigestV2(genesis.acceptedFrontierDigest),
        }),
        bridge: parseProtocolPromotionBridgeV3(source.bridge),
      })
    } catch (error) {
      return (error as NodeJS.ErrnoException).code === "ENOENT" ? "missing" : "rejected"
    }
  }
}

