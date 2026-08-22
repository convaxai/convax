import {
  encodeRestrictedJcs,
  ordinarySha256,
  parseDocumentScope,
  type DocumentScope,
  type DecodedCausalEditFrame,
  type IncomingOwnerFactResolverPort,
  type OwnerExternalFactPortFactory,
  type OwnerExternalFactRequirement,
  type OwnerIntentDependencies,
  type OwnerValidationArtifactResolveResult,
  type ValidationArtifactRef,
} from "@convax/collaboration"
import {
  decodeCanvasExternalFactRequest,
  type CanvasExternalFactRequest,
} from "@convax/canvas/collaboration"
import {
  projectIndexResourceReferenceDigest,
  type ProjectBlobAvailabilityQueryPort,
  type ProjectIndexCurrentResourceReferenceQueryPort,
} from "@convax/project"
import { parseProjectUri } from "@convax/uri"

import type { CanvasFactResolution } from "./canvas-collaboration-session-owner"

type CanvasScope = DocumentScope & { readonly docKind: "canvas" }

export interface CanvasRouteArtifactAuthority {
  resolve(input: {
    readonly scope: CanvasScope
    readonly ref: ValidationArtifactRef
    readonly signal?: AbortSignal
  }): Promise<OwnerValidationArtifactResolveResult>
}

export interface CanvasRouteExternalFactAuthority {
  verify(input: {
    readonly scope: CanvasScope
    readonly request: CanvasExternalFactRequest
    readonly requirement: OwnerExternalFactRequirement<"canvas">
    readonly signal?: AbortSignal
  }): Promise<"verified" | "pending" | "rejected">
}

/** Async route edge that creates the attempt-scoped branded owner port only after every fact closes. */
export function createRouteScopedCanvasFactResolver(input: {
  readonly factory: OwnerExternalFactPortFactory<"canvas">
  readonly artifacts?: CanvasRouteArtifactAuthority
  readonly facts?: CanvasRouteExternalFactAuthority
}) {
  return async function resolve(inputAttempt: {
    readonly scope: CanvasScope
    readonly dependencies: OwnerIntentDependencies<"canvas">
    readonly signal?: AbortSignal
  }): Promise<CanvasFactResolution> {
    const scope = requireCanvasScope(inputAttempt.scope)
    inputAttempt.signal?.throwIfAborted()
    const artifacts = new Map<string, Extract<OwnerValidationArtifactResolveResult, { status: "resolved" }>>()
    for (const ref of inputAttempt.dependencies.validationArtifacts) {
      if (!input.artifacts) return Object.freeze({ status: "pending" })
      const resolved = await input.artifacts.resolve({ scope, ref, signal: inputAttempt.signal })
      inputAttempt.signal?.throwIfAborted()
      if (resolved.status !== "resolved") return Object.freeze({ status: resolved.status })
      artifacts.set(artifactKey(ref), resolved)
    }

    const facts = new Map<string, unknown>()
    for (const requirement of inputAttempt.dependencies.externalFacts) {
      const exactJcs = new Uint8Array(requirement.request.exactJcs)
      const request = decodeCanvasExternalFactRequest(exactJcs)
      if (
        request === "rejected" ||
        requirement.owner !== "canvas" ||
        requirement.kind !== request.kind ||
        ordinarySha256(exactJcs) !== requirement.request.sha256 ||
        ((request.kind === "current-resources" || request.kind === "retained-resources") &&
          requirement.factDigest !== requirement.request.sha256) ||
        !requestBelongsToScope(request, scope)
      ) {
        return Object.freeze({ status: "rejected" })
      }
      if (!input.facts) return Object.freeze({ status: "pending" })
      const decision = await input.facts.verify({ scope, request, requirement, signal: inputAttempt.signal })
      inputAttempt.signal?.throwIfAborted()
      if (decision !== "verified") return Object.freeze({ status: decision })
      facts.set(factKey(requirement), Object.freeze({
        format: "convax.canvas-external-fact-result",
        kind: requirement.kind,
        requestSha256: requirement.request.sha256,
        factDigest: requirement.factDigest,
        decision: "verified",
      }))
    }

    const created = input.factory.createAttemptPort({
      declared: inputAttempt.dependencies,
      resolver: Object.freeze({
        owner: "canvas" as const,
        resolveArtifact(ref: ValidationArtifactRef) {
          return artifacts.get(artifactKey(ref)) ?? Object.freeze({ status: "rejected" as const, code: "artifact-not-declared" as const })
        },
        resolveFact(requirement: OwnerExternalFactRequirement<"canvas">) {
          const value = facts.get(factKey(requirement))
          return value === undefined
            ? Object.freeze({ status: "rejected" as const, code: "fact-not-declared" as const })
            : Object.freeze({ status: "resolved" as const, requirement, value })
        },
      }),
    })
    return created.status === "created"
      ? Object.freeze({ status: "resolved", port: created.port })
      : Object.freeze({ status: "rejected" })
  }
}

/** Resolves current-resource authority and retained immutable material through distinct Project ports. */
export function createProjectIndexBackedCanvasExternalFactAuthority(input: {
  readonly currentResources: Pick<ProjectIndexCurrentResourceReferenceQueryPort, "queryCurrentResourceReferences">
  readonly availableBlobs: Pick<ProjectBlobAvailabilityQueryPort, "queryAvailableBlobs">
}): CanvasRouteExternalFactAuthority {
  return Object.freeze({
    async verify(request: Parameters<CanvasRouteExternalFactAuthority["verify"]>[0]) {
      request.signal?.throwIfAborted()
      if (request.request.kind === "current-resources") {
        const current = await input.currentResources.queryCurrentResourceReferences({
          projectId: request.scope.projectId,
        })
        request.signal?.throwIfAborted()
        const verified = request.request.proofs.every((proof) => current.some((reference) => {
          // Narrow by the exact portable resource fields before canonicalizing
          // the owner proof. A large Project may contain hundreds of current
          // references, while one Canvas creation ordinarily proves one newly
          // published resource. The final digest check remains authoritative.
          if (proof.resource.uri !== reference.canonicalUri) return false
          if (
            proof.resource.contentDigest !== reference.blob.digest ||
            proof.resource.byteLength !== reference.blob.byteLength ||
            proof.resource.mime !== reference.blob.mime ||
            proof.resource.mediaClass !== mediaClassForMime(reference.blob.mime)
          ) return false
          const digest = projectIndexResourceReferenceDigest(reference)
          return proof.ownerProofDigest === digest && proof.resource.ownerProofDigest === digest
        }))
        return verified ? "verified" : "rejected"
      }
      if (request.request.kind !== "retained-resources") return "pending"
      const wanted = request.request.proofs.map((proof) => Object.freeze({
        blobSha256: proof.resource.contentDigest,
        byteLength: proof.resource.byteLength,
      }))
      const available = await input.availableBlobs.queryAvailableBlobs({
        projectId: request.scope.projectId,
        blobs: wanted,
      })
      request.signal?.throwIfAborted()
      const wantedKeys = new Set(wanted.map(blobKey))
      const availableKeys = new Set<string>()
      for (const blob of available) {
        const key = blobKey(blob)
        if (!wantedKeys.has(key) || availableKeys.has(key)) return "rejected"
        availableKeys.add(key)
      }
      return wanted.every((blob) => availableKeys.has(blobKey(blob))) ? "verified" : "pending"
    },
  })
}

/** Incoming frames use the same exact route-scoped authority and never trust their peer/session identity. */
export function createRouteScopedCanvasIncomingFactResolver(input: {
  readonly scope: CanvasScope
  readonly resolve: ReturnType<typeof createRouteScopedCanvasFactResolver>
}): IncomingOwnerFactResolverPort {
  const scope = requireCanvasScope(input.scope)
  return Object.freeze({
    async resolve(attempt: {
      readonly frame: DecodedCausalEditFrame
      readonly declaredDependencies: OwnerIntentDependencies<"canvas">
      readonly signal?: AbortSignal
    }) {
      const frameScope = parseDocumentScope(attempt.frame.header.core.scope)
      if (!sameScope(frameScope, scope)) return Object.freeze({ status: "rejected" as const })
      const result = await input.resolve({ scope, dependencies: attempt.declaredDependencies, signal: attempt.signal })
      return result.status === "resolved"
        ? Object.freeze({ status: "resolved" as const, port: result.port })
        : Object.freeze({ status: result.status })
    },
  })
}


function requireCanvasScope(value: DocumentScope): CanvasScope {
  const scope = parseDocumentScope(value)
  if (scope.docKind !== "canvas") throw new TypeError("Canvas external facts require a Canvas scope")
  return scope as CanvasScope
}

function requestBelongsToScope(request: CanvasExternalFactRequest, scope: CanvasScope): boolean {
  if (request.kind === "generation-begin") {
    const requestScope = parseDocumentScope(request.scope)
    return sameScope(requestScope, scope)
  }
  if (request.kind === "generation-recovery") return true
  try {
    return request.proofs.every((proof) => {
      const uri = parseProjectUri(proof.resource.uri)
      return uri.projectId === scope.projectId && uri.projectEpoch === scope.projectEpoch
    })
  } catch {
    return false
  }
}

function mediaClassForMime(mime: string): "text" | "image" | "video" | "audio" | "file" {
  const normalized = mime.split(";", 1)[0]!.trim().toLowerCase()
  if (normalized.startsWith("text/")) return "text"
  if (normalized.startsWith("image/")) return "image"
  if (normalized.startsWith("video/")) return "video"
  if (normalized.startsWith("audio/")) return "audio"
  return "file"
}

function blobKey(blob: { readonly blobSha256: string; readonly byteLength: string }): string {
  return `${blob.blobSha256}\0${blob.byteLength}`
}

function sameScope(left: DocumentScope, right: DocumentScope): boolean {
  return left.projectId === right.projectId && left.projectEpoch === right.projectEpoch &&
    left.docKind === right.docKind && left.docId === right.docId && left.shardEpoch === right.shardEpoch
}

function artifactKey(ref: ValidationArtifactRef): string {
  return bytesKey(encodeRestrictedJcs(ref))
}

function factKey(requirement: OwnerExternalFactRequirement<"canvas">): string {
  return `${requirement.owner}\0${requirement.kind}\0${requirement.factDigest}\0${requirement.request.sha256}`
}

function bytesKey(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("hex")
}
