import type {
  DecodedCausalEditFrameV2,
  DocumentScopeV2,
  IncomingOwnerFactResolverPortV2,
  OwnerExternalFactPortFactoryV2,
  OwnerExternalFactRequirementV2,
  OwnerIntentDependenciesV2,
} from "@convax/collaboration"
import {
  ordinarySha256V2,
  parseDocumentScopeV2,
} from "@convax/collaboration"
import type { CanvasGenesisProofCarrierVerifierV2 } from "@convax/canvas/collaboration"
import {
  decodeProjectIndexBlobPublicationCurrentnessRequestV2,
  decodeProjectIndexCanvasGenesisCurrentnessRequestV2,
  type ProjectIndexCanvasGenesisCurrentnessRequestV2,
} from "@convax/project"
import type {
  ProjectCanvasGenesisStagingPortV2,
  ProjectIndexFactResolutionPortV2,
} from "@convax/project/canvas"
import type { NodeCollaborationPersistenceV2 } from "@convax/project/node"
import type { ProjectBlobReplicationStoreV2 } from "@convax/project/node"

import {
  stageDurableDocumentGenesisV2,
  type DocumentGenesisVerifierPortV2,
} from "./collaboration-document-genesis"

/**
 * First production closure: read/query and dependency-free ProjectIndex frames work;
 * mutation requiring blob, Canvas-genesis or reset authority remains pending.
 */
export function createFailClosedProjectIndexFactPortsV2(input: {
  readonly factory: OwnerExternalFactPortFactoryV2<"project-index">
  readonly scope: DocumentScopeV2 & { readonly docKind: "project-index" }
}): Readonly<{
  facts: ProjectIndexFactResolutionPortV2
  incomingFacts: IncomingOwnerFactResolverPortV2
  canvasGenesis: ProjectCanvasGenesisStagingPortV2
}> {
  const resolve = async (dependencies: OwnerIntentDependenciesV2<"project-index">) => {
    if (dependencies.validationArtifacts.length !== 0 || dependencies.externalFacts.length !== 0) {
      return Object.freeze({ status: "pending" as const })
    }
    const created = input.factory.createAttemptPort({
      declared: dependencies,
      resolver: Object.freeze({
        owner: "project-index" as const,
        resolveArtifact: () => Object.freeze({ status: "rejected" as const, code: "artifact-not-declared" as const }),
        resolveFact: () => Object.freeze({ status: "rejected" as const, code: "fact-not-declared" as const }),
      }),
    })
    return created.status === "created"
      ? Object.freeze({ status: "resolved" as const, port: created.port })
      : Object.freeze({ status: "rejected" as const })
  }
  const facts: ProjectIndexFactResolutionPortV2 = Object.freeze({
    resolve: (attempt: Parameters<ProjectIndexFactResolutionPortV2["resolve"]>[0]) => resolve(attempt.dependencies),
  })
  const incomingFacts: IncomingOwnerFactResolverPortV2 = Object.freeze({
    async resolve({ frame, declaredDependencies }: {
      readonly frame: DecodedCausalEditFrameV2
      readonly declaredDependencies: OwnerIntentDependenciesV2<"project-index">
    }) {
      if (!sameScope(frame.header.core.scope, input.scope)) return Object.freeze({ status: "rejected" as const })
      return resolve(declaredDependencies)
    },
  })
  const canvasGenesis: ProjectCanvasGenesisStagingPortV2 = Object.freeze({
    async preflightCanvasGenesis() { return "pending" as const },
    async stageCanvasGenesis() { return "pending" as const },
  })
  return Object.freeze({ facts, incomingFacts, canvasGenesis })
}

/** Local blob durability is a Project-owned external fact; paths and filesystem mtimes never satisfy it. */
export function createLocalBlobProjectIndexFactPortsV2(input: {
  readonly factory: OwnerExternalFactPortFactoryV2<"project-index">
  readonly scope: DocumentScopeV2 & { readonly docKind: "project-index" }
  readonly blobs: Pick<ProjectBlobReplicationStoreV2, "queryHave">
}): Readonly<{
  facts: ProjectIndexFactResolutionPortV2
  incomingFacts: IncomingOwnerFactResolverPortV2
  canvasGenesis: ProjectCanvasGenesisStagingPortV2
}> {
  const scope = requireProjectIndexScope(input.scope)
  const resolve = async (dependencies: OwnerIntentDependenciesV2<"project-index">) => {
    if (dependencies.validationArtifacts.length !== 0) return Object.freeze({ status: "pending" as const })
    const facts = new Map<string, unknown>()
    for (const requirement of dependencies.externalFacts) {
      if (requirement.kind !== "blob-publication-currentness") return Object.freeze({ status: "pending" as const })
      const request = decodeProjectIndexBlobPublicationCurrentnessRequestV2(requirement.request.exactJcs)
      if (
        request === "rejected" ||
        !sameScope(request.projectIndexScope, scope) ||
        ordinarySha256V2(new Uint8Array(requirement.request.exactJcs)) !== requirement.request.sha256 ||
        requirement.factDigest !== requirement.request.sha256
      ) return Object.freeze({ status: "rejected" as const })
      const have = await input.blobs.queryHave([{ blobSha256: request.blob.digest, byteLength: request.blob.byteLength }])
      if (have.length !== 1 || have[0]?.blobSha256 !== request.blob.digest || have[0]?.byteLength !== request.blob.byteLength) {
        return Object.freeze({ status: "pending" as const })
      }
      facts.set(requirement.factDigest, Object.freeze({
        format: "convax.project-index-external-fact-result/2",
        kind: requirement.kind,
        requestSha256: requirement.request.sha256,
        factDigest: requirement.factDigest,
        decision: "verified",
      }))
    }
    const created = input.factory.createAttemptPort({
      declared: dependencies,
      resolver: Object.freeze({
        owner: "project-index" as const,
        resolveArtifact: () => Object.freeze({ status: "rejected" as const, code: "artifact-not-declared" as const }),
        resolveFact(requirement: OwnerExternalFactRequirementV2<"project-index">) {
          const value = facts.get(requirement.factDigest)
          return value === undefined
            ? Object.freeze({ status: "rejected" as const, code: "fact-not-declared" as const })
            : Object.freeze({ status: "resolved" as const, requirement, value })
        },
      }),
    })
    return created.status === "created"
      ? Object.freeze({ status: "resolved" as const, port: created.port })
      : Object.freeze({ status: "rejected" as const })
  }
  return Object.freeze({
    facts: Object.freeze({ resolve: (request: Parameters<ProjectIndexFactResolutionPortV2["resolve"]>[0]) => resolve(request.dependencies) }),
    incomingFacts: Object.freeze({
      async resolve(request: Parameters<IncomingOwnerFactResolverPortV2["resolve"]>[0]) {
        if (!sameScope(request.frame.header.core.scope, scope)) return Object.freeze({ status: "rejected" as const })
        return resolve(request.declaredDependencies as OwnerIntentDependenciesV2<"project-index">)
      },
    }),
    canvasGenesis: Object.freeze({
      async preflightCanvasGenesis() { return "pending" as const },
      async stageCanvasGenesis() { return "pending" as const },
    }),
  })
}

/**
 * Exact local ProjectIndex -> Canvas genesis bridge. It owns no Canvas schema:
 * CVXCGP02 build/validation stays behind the Canvas verifier, while Project owns
 * the request codec and native Project persistence owns the sole durable bytes.
 */
export function createProjectIndexCanvasGenesisFactPortsV2(input: {
  readonly factory: OwnerExternalFactPortFactoryV2<"project-index">
  readonly scope: DocumentScopeV2 & { readonly docKind: "project-index" }
  readonly persistence: Pick<
    NodeCollaborationPersistenceV2,
    "initializeShardWithGenesisProof" | "readGenesisProof"
  >
  readonly genesisVerifier: DocumentGenesisVerifierPortV2<"canvas">
  readonly proofVerifier: CanvasGenesisProofCarrierVerifierV2
  readonly preflightAuthor: (input: {
    readonly projectId: DocumentScopeV2["projectId"]
    readonly projectEpoch: DocumentScopeV2["projectEpoch"]
    readonly signal?: AbortSignal
  }) => Promise<"ready" | "pending" | "rejected">
}): Readonly<{
  facts: ProjectIndexFactResolutionPortV2
  incomingFacts: IncomingOwnerFactResolverPortV2
  canvasGenesis: ProjectCanvasGenesisStagingPortV2
}> {
  const projectIndexScope = requireProjectIndexScope(input.scope)

  const resolve = async (
    dependencies: OwnerIntentDependenciesV2<"project-index">,
    signal?: AbortSignal,
  ) => {
    signal?.throwIfAborted()
    if (dependencies.validationArtifacts.length !== 0) {
      return Object.freeze({ status: "pending" as const })
    }
    const facts = new Map<string, unknown>()
    for (const requirement of dependencies.externalFacts) {
      const request = decodeGenesisRequirement(requirement, projectIndexScope)
      if (request === "rejected") return Object.freeze({ status: "rejected" as const })
      let carrier: Uint8Array
      try {
        carrier = await input.persistence.readGenesisProof(
          request.canvasScope,
          request.genesisCheckpointObjectDigest,
        )
      } catch (error) {
        return Object.freeze({
          status: isMissingGenesis(error) ? "pending" as const : "rejected" as const,
        })
      }
      signal?.throwIfAborted()
      const verified = input.proofVerifier(carrier)
      if (verified.status !== "validated") {
        return Object.freeze({ status: verified.status === "pending" ? "pending" as const : "rejected" as const })
      }
      if (
        verified.identity.checkpointObjectDigest !== request.genesisCheckpointObjectDigest ||
        !sameScope(verified.identity.scope, request.canvasScope) ||
        verified.identity.identity.projectIndexRouteDependencyFrameDigest !== request.routeDependencyFrameDigest
      ) {
        return Object.freeze({ status: "rejected" as const })
      }
      facts.set(requirement.factDigest, Object.freeze({
        format: "convax.project-index-external-fact-result/2",
        kind: requirement.kind,
        requestSha256: requirement.request.sha256,
        factDigest: requirement.factDigest,
        decision: "verified",
      }))
    }
    const created = input.factory.createAttemptPort({
      declared: dependencies,
      resolver: Object.freeze({
        owner: "project-index" as const,
        resolveArtifact: () => Object.freeze({
          status: "rejected" as const,
          code: "artifact-not-declared" as const,
        }),
        resolveFact(requirement: OwnerExternalFactRequirementV2<"project-index">) {
          const value = facts.get(requirement.factDigest)
          return value === undefined
            ? Object.freeze({ status: "rejected" as const, code: "fact-not-declared" as const })
            : Object.freeze({ status: "resolved" as const, requirement, value })
        },
      }),
    })
    return created.status === "created"
      ? Object.freeze({ status: "resolved" as const, port: created.port })
      : Object.freeze({ status: "rejected" as const })
  }

  const facts: ProjectIndexFactResolutionPortV2 = Object.freeze({
    resolve: (request: Parameters<ProjectIndexFactResolutionPortV2["resolve"]>[0]) =>
      resolve(request.dependencies, request.signal),
  })
  const incomingFacts: IncomingOwnerFactResolverPortV2 = Object.freeze({
    async resolve(request: Parameters<IncomingOwnerFactResolverPortV2["resolve"]>[0]) {
      const { frame, declaredDependencies, signal } = request
      if (!sameScope(frame.header.core.scope, projectIndexScope)) {
        return Object.freeze({ status: "rejected" as const })
      }
      if (declaredDependencies.externalFacts.some((requirement) => requirement.owner !== "project-index")) {
        return Object.freeze({ status: "rejected" as const })
      }
      return resolve(declaredDependencies as OwnerIntentDependenciesV2<"project-index">, signal)
    },
  })
  const canvasGenesis: ProjectCanvasGenesisStagingPortV2 = Object.freeze({
    async preflightCanvasGenesis(request: Parameters<ProjectCanvasGenesisStagingPortV2["preflightCanvasGenesis"]>[0]) {
      if (!sameScope(request.projectIndexScope, projectIndexScope)) return "rejected"
      return input.preflightAuthor({
        projectId: projectIndexScope.projectId,
        projectEpoch: projectIndexScope.projectEpoch,
        signal: request.signal,
      })
    },
    async stageCanvasGenesis(request: Parameters<ProjectCanvasGenesisStagingPortV2["stageCanvasGenesis"]>[0]) {
      if (!sameProjectEpoch(request.scope, projectIndexScope)) return "rejected"
      const staged = await stageDurableDocumentGenesisV2({
        scope: request.scope,
        predecessor: request.predecessor,
        verifier: input.genesisVerifier,
        store: input.persistence,
        signal: request.signal,
      })
      if (typeof staged === "string") return staged
      return Object.freeze({
        predecessorFrameDigest: staged.predecessorFrameDigest,
        stagedProjectIndexFrontierDigest: staged.stagedProjectIndexFrontierDigest,
        checkpointObjectDigest: staged.checkpointObjectDigest,
      })
    },
  })
  return Object.freeze({ facts, incomingFacts, canvasGenesis })
}

function decodeGenesisRequirement(
  requirement: OwnerExternalFactRequirementV2<"project-index">,
  scope: DocumentScopeV2 & { readonly docKind: "project-index" },
): ProjectIndexCanvasGenesisCurrentnessRequestV2 | "rejected" {
  if (
    requirement.owner !== "project-index" ||
    requirement.kind !== "canvas-genesis-currentness" ||
    ordinarySha256V2(new Uint8Array(requirement.request.exactJcs)) !== requirement.request.sha256 ||
    requirement.factDigest !== requirement.request.sha256
  ) return "rejected"
  const request = decodeProjectIndexCanvasGenesisCurrentnessRequestV2(requirement.request.exactJcs)
  if (request === "rejected" || !sameScope(request.projectIndexScope, scope)) return "rejected"
  return request
}

function requireProjectIndexScope(
  value: DocumentScopeV2,
): DocumentScopeV2 & { readonly docKind: "project-index"; readonly docId: "project-index" } {
  const scope = parseDocumentScopeV2(value)
  if (scope.docKind !== "project-index" || scope.docId !== "project-index") {
    throw new TypeError("ProjectIndex genesis facts require a ProjectIndex scope")
  }
  return scope as DocumentScopeV2 & { readonly docKind: "project-index"; readonly docId: "project-index" }
}

function sameProjectEpoch(left: DocumentScopeV2, right: DocumentScopeV2): boolean {
  const parsed = parseDocumentScopeV2(left)
  return parsed.docKind === "canvas" && parsed.projectId === right.projectId &&
    parsed.projectEpoch === right.projectEpoch
}

function isMissingGenesis(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error &&
    error.code === "document-not-found"
}

function sameScope(left: DocumentScopeV2, right: DocumentScopeV2): boolean {
  return left.projectId === right.projectId && left.projectEpoch === right.projectEpoch &&
    left.docKind === right.docKind && left.docId === right.docId && left.shardEpoch === right.shardEpoch
}
