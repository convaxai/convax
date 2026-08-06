import { createPublicKey, verify as verifySignature } from "node:crypto"
import {
  encodeBase64url,
  encodeRestrictedJcs,
  parseDigest,
  parseId128,
  parseProjectId,
  parseSignature,
  structuredDigest,
  type CurrentProtocolAuthority,
  type Digest,
  type DocumentScope,
  type ValidationArtifactRef,
} from "@convax/collaboration"
import type {
  CanvasGenesisBuildAuthor,
  CanvasGenesisHistoricalAuthorVerifierPort,
} from "@convax/canvas/collaboration"
import { PROJECT_INDEX_PROTOCOL_SCHEMA_ARTIFACT_DIGEST } from "@convax/project"

import type { CanvasGenesisAuthorProviderPort } from "./canvas-document-genesis"
import {
  parseDurableLocalProjectOwnerBindingExact,
  type ResolvedLocalProjectOwnerAuthority,
} from "./local-project-owner-authority"

const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex")

export function createLocalProjectOwnerCanvasGenesisAuthority(input: {
  readonly authority: CurrentProtocolAuthority
  resolveOwner(input: {
    readonly projectId: DocumentScope["projectId"]
    readonly projectEpoch: DocumentScope["projectEpoch"]
  }): Promise<ResolvedLocalProjectOwnerAuthority | "missing" | "rejected">
}): Readonly<{
  authorProvider: CanvasGenesisAuthorProviderPort
  historicalAuthorVerifier: CanvasGenesisHistoricalAuthorVerifierPort
}> {
  const validationArtifacts = selectedValidationArtifactMaterial(input.authority)
  const validationArtifactSetDigest = structuredDigest("convax.validation-artifact-set", {
    format: "convax.validation-artifact-set",
    artifacts: validationArtifacts.map((entry) => entry.artifact),
  })
  const resolve = async (projectId: DocumentScope["projectId"], projectEpoch: DocumentScope["projectEpoch"]) =>
    input.resolveOwner({ projectId: parseProjectId(projectId), projectEpoch: parseId128(projectEpoch) })

  const authorProvider: CanvasGenesisAuthorProviderPort = Object.freeze({
    async preflight(request: Parameters<CanvasGenesisAuthorProviderPort["preflight"]>[0]) {
      request.signal?.throwIfAborted()
      const owner = await resolve(request.projectId, request.projectEpoch)
      return owner === "missing" ? "pending" : owner === "rejected" ? "rejected" : "ready"
    },
    async prepareAuthor(request: Parameters<CanvasGenesisAuthorProviderPort["prepareAuthor"]>[0]) {
      request.signal?.throwIfAborted()
      const owner = await resolve(request.scope.projectId, request.scope.projectEpoch)
      if (owner === "missing") return Object.freeze({ status: "pending" })
      if (owner === "rejected") return Object.freeze({ status: "rejected" })
      const binding = owner.binding
      const author: CanvasGenesisBuildAuthor = Object.freeze({
        checkpointId: deterministicCheckpointId(request.scope),
        authorMemberId: binding.memberId,
        authorReplicaId: binding.replicaId,
        authorActorId: binding.actorId,
        authorAuthorizationDigest: binding.bindingDigest,
        authorAuthorityKind: "local-project-owner",
        authorAuthorityDigest: binding.bindingDigest,
        authorAuthorityExactBytes: new Uint8Array(owner.bindingExactBytes),
        validationArtifacts,
        signCheckpointCoreDigest: (coreDigest: Digest) => owner.signer.sign(Buffer.from(parseDigest(coreDigest), "hex")),
      })
      return Object.freeze({ status: "prepared", author })
    },
  })

  const historicalAuthorVerifier: CanvasGenesisHistoricalAuthorVerifierPort = Object.freeze({
    verifyHistoricalAuthor(request: Parameters<CanvasGenesisHistoricalAuthorVerifierPort["verifyHistoricalAuthor"]>[0]) {
      try {
        if (request.authorAuthorityKind !== "local-project-owner") return Object.freeze({ status: "pending" })
        const binding = parseDurableLocalProjectOwnerBindingExact(
          new Uint8Array(request.authorAuthorityExactBytes),
          {
            projectId: request.scope.projectId,
            projectEpoch: request.scope.projectEpoch,
            protocolDigest: input.authority.protocolDigest,
            schemaDigest: PROJECT_INDEX_PROTOCOL_SCHEMA_ARTIFACT_DIGEST,
            uriProtocolDigest: input.authority.protocolSchemaBundle.core.uriProtocolDigest,
            validationArtifactSetDigest,
          },
        )
        const checkpoint = request.checkpoint
        if (
          binding.bindingDigest !== parseDigest(request.authorAuthorityDigest) ||
          checkpoint.core.authorAuthorizationDigest !== binding.bindingDigest ||
          checkpoint.core.authorMemberId !== binding.memberId ||
          checkpoint.core.authorReplicaId !== binding.replicaId ||
          checkpoint.core.authorActorId !== binding.actorId ||
          checkpoint.core.validationArtifactSetDigest !== validationArtifactSetDigest ||
          !verifyOwnerSignature(binding.publicKey, checkpoint.coreDigest, checkpoint.replicaSignature)
        ) return Object.freeze({ status: "rejected" })
        return Object.freeze({
          status: "verified",
          authorActorId: binding.actorId,
          authorReplicaId: binding.replicaId,
          authorAuthorityDigest: binding.bindingDigest,
        })
      } catch {
        return Object.freeze({ status: "rejected" })
      }
    },
  })
  return Object.freeze({ authorProvider, historicalAuthorVerifier })
}

function deterministicCheckpointId(scope: DocumentScope): ReturnType<typeof parseId128> {
  const digest = structuredDigest("convax.canvas-genesis-core", {
    format: "convax.canvas-local-genesis-checkpoint-id",
    scope,
  })
  return parseId128(encodeBase64url(new Uint8Array(Buffer.from(digest, "hex").subarray(0, 16))))
}

function selectedValidationArtifactMaterial(
  authority: CurrentProtocolAuthority,
): readonly Readonly<{ artifact: ValidationArtifactRef; exactBytes: Uint8Array }>[] {
  const ownerByName = new Map([
    ["canvas-schema", "canvas"],
    ["collaboration-kernel", "kernel"],
    ["control-plane", "control-plane"],
    ["project-persistence", "project-index"],
  ] as const)
  return Object.freeze(authority.protocolSchemaBundle.core.artifacts
    .map((selected) => {
      const owner = ownerByName.get(selected.name)
      if (!owner) throw new Error(`Unsupported protocol artifact ${selected.name}`)
      const artifact = Object.freeze({ owner, format: selected.format, artifactDigest: selected.artifactDigest })
      return Object.freeze({
        artifact,
        exactBytes: encodeRestrictedJcs(Object.freeze({
          format: "convax.selected-protocol-schema-artifact",
          artifact,
        })),
      })
    })
    .sort((left, right) => left.artifact.owner.localeCompare(right.artifact.owner)))
}

function verifyOwnerSignature(publicKey: string, coreDigest: Digest, signature: string): boolean {
  const key = createPublicKey({
    key: Buffer.concat([ED25519_SPKI_PREFIX, Buffer.from(publicKey, "base64url")]),
    format: "der",
    type: "spki",
  })
  return verifySignature(
    null,
    Buffer.from(parseDigest(coreDigest), "hex"),
    key,
    Buffer.from(parseSignature(signature), "base64url"),
  )
}
