import {
  encodeRestrictedJcs,
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
  decodeCanvasExternalFactRequestV2,
  type CanvasExternalFactRequestV2,
} from "@convax/canvas/collaboration"
import { parseProjectUri } from "@convax/uri"

import type { CanvasFactResolutionV2 } from "./canvas-collaboration-session-owner"

type CanvasScopeV2 = DocumentScope & { readonly docKind: "canvas" }

export interface CanvasRouteArtifactAuthorityV2 {
  resolve(input: {
    readonly scope: CanvasScopeV2
    readonly ref: ValidationArtifactRef
    readonly signal?: AbortSignal
  }): Promise<OwnerValidationArtifactResolveResult>
}

export interface CanvasRouteExternalFactAuthorityV2 {
  verify(input: {
    readonly scope: CanvasScopeV2
    readonly request: CanvasExternalFactRequestV2
    readonly requirement: OwnerExternalFactRequirement<"canvas">
    readonly signal?: AbortSignal
  }): Promise<"verified" | "pending" | "rejected">
}

/** Async route edge that creates the attempt-scoped branded owner port only after every fact closes. */
export function createRouteScopedCanvasFactResolverV2(input: {
  readonly factory: OwnerExternalFactPortFactory<"canvas">
  readonly artifacts?: CanvasRouteArtifactAuthorityV2
  readonly facts?: CanvasRouteExternalFactAuthorityV2
}) {
  return async function resolve(inputAttempt: {
    readonly scope: CanvasScopeV2
    readonly dependencies: OwnerIntentDependencies<"canvas">
    readonly signal?: AbortSignal
  }): Promise<CanvasFactResolutionV2> {
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
      const request = decodeCanvasExternalFactRequestV2(new Uint8Array(requirement.request.exactJcs))
      if (request === "rejected" || !requestBelongsToScope(request, scope)) {
        return Object.freeze({ status: "rejected" })
      }
      if (!input.facts) return Object.freeze({ status: "pending" })
      const decision = await input.facts.verify({ scope, request, requirement, signal: inputAttempt.signal })
      inputAttempt.signal?.throwIfAborted()
      if (decision !== "verified") return Object.freeze({ status: decision })
      facts.set(factKey(requirement), Object.freeze({
        format: "convax.canvas-external-fact-result/2",
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

/** Incoming frames use the same exact route-scoped authority and never trust their peer/session identity. */
export function createRouteScopedCanvasIncomingFactResolverV2(input: {
  readonly scope: CanvasScopeV2
  readonly resolve: ReturnType<typeof createRouteScopedCanvasFactResolverV2>
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


function requireCanvasScope(value: DocumentScope): CanvasScopeV2 {
  const scope = parseDocumentScope(value)
  if (scope.docKind !== "canvas") throw new TypeError("Canvas external facts require a Canvas scope")
  return scope as CanvasScopeV2
}

function requestBelongsToScope(request: CanvasExternalFactRequestV2, scope: CanvasScopeV2): boolean {
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
