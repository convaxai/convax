import type { VerifiedProtocolAuthorityV2 } from "./authority"
import type { ValidationArtifactRefV2, ValidationArtifactSetV2 } from "./contracts"
import { parseValidationArtifactSetV2 } from "./parse"
import {
  assertSuccessorProtocolAuthorityV3,
  type SuccessorProtocolSchemaArtifactRefV3,
  type VerifiedProtocolAuthorityV3,
} from "./successor-frame"

const V3_OWNER_BY_NAME = Object.freeze({
  "canvas-schema": "canvas",
  "collaboration-kernel": "kernel",
  "control-plane": "control-plane",
  "project-persistence": "project-index",
} as const)

/**
 * The V3 frame closes both its selected V11 implementation artifacts and the
 * pinned R5 owner-language artifacts used to interpret unchanged typed intents.
 */
export function selectedSuccessorValidationArtifactSetV3(
  authority: VerifiedProtocolAuthorityV3,
  historical: VerifiedProtocolAuthorityV2,
): ValidationArtifactSetV2 {
  assertSuccessorProtocolAuthorityV3(authority)
  if (historical.protocolDigest !== authority.historicalAuthority.protocolDigest) {
    throw new Error("V3 validation artifacts crossed the pinned historical authority")
  }
  const v11 = authority.artifactRefs.map((artifact) => v3Ref(artifact))
  const r5 = historical.protocolSchemaBundle.core.artifacts.map((artifact, index) => Object.freeze({
    owner: (["canvas", "kernel", "control-plane", "project-index"] as const)[index]!,
    format: artifact.format,
    artifactDigest: artifact.artifactDigest,
  }))
  return parseValidationArtifactSetV2({
    format: "convax.validation-artifact-set/2",
    artifacts: [...v11, ...r5].sort(compareArtifact),
  })
}

function v3Ref(artifact: SuccessorProtocolSchemaArtifactRefV3): ValidationArtifactRefV2 {
  return Object.freeze({
    owner: V3_OWNER_BY_NAME[artifact.name],
    format: artifact.format,
    artifactDigest: artifact.artifactDigest,
  })
}

function compareArtifact(left: ValidationArtifactRefV2, right: ValidationArtifactRefV2): number {
  return left.owner.localeCompare(right.owner) || left.format.localeCompare(right.format) || left.artifactDigest.localeCompare(right.artifactDigest)
}
