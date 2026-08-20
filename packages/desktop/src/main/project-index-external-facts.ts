import type {
  DecodedCausalEditFrame,
  DocumentScope,
  IncomingOwnerFactResolverPort,
  OwnerExternalFactPortFactory,
  OwnerExternalFactRequirement,
  OwnerIntentDependencies,
} from "@convax/collaboration"
import {
  ordinarySha256,
  parseDocumentScope,
} from "@convax/collaboration"
import type { CanvasGenesisProofCarrierVerifier } from "@convax/canvas/collaboration"
import {
  decodeProjectIndexBlobPublicationCurrentnessRequest,
  decodeProjectIndexCanvasGenesisCurrentnessRequest,
  type ProjectIndexCanvasGenesisCurrentnessRequest,
} from "@convax/project"
import type {
  ProjectCanvasGenesisStagingPort,
  ProjectIndexFactResolutionPort,
} from "@convax/project/canvas"
import {
  stageDurableProjectDocumentGenesis,
  type NodeCollaborationPersistence,
  type ProjectBlobReplicationStore,
  type ProjectDocumentGenesisVerifierPort,
} from "@convax/project/node"

/**
 * First production closure: read/query and dependency-free ProjectIndex frames work;
 * mutation requiring blob, Canvas-genesis or reset authority remains pending.
 */
export function createFailClosedProjectIndexFactPorts(input: {
  readonly factory: OwnerExternalFactPortFactory<"project-index">
  readonly scope: DocumentScope & { readonly docKind: "project-index" }
}): Readonly<{
  facts: ProjectIndexFactResolutionPort
  incomingFacts: IncomingOwnerFactResolverPort
  canvasGenesis: ProjectCanvasGenesisStagingPort
}> {
  const resolve = async (dependencies: OwnerIntentDependencies<"project-index">) => {
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
  const facts: ProjectIndexFactResolutionPort = Object.freeze({
    resolve: (attempt: Parameters<ProjectIndexFactResolutionPort["resolve"]>[0]) => resolve(attempt.dependencies),
  })
  const incomingFacts: IncomingOwnerFactResolverPort = Object.freeze({
    async resolve({ frame, declaredDependencies }: {
      readonly frame: DecodedCausalEditFrame
      readonly declaredDependencies: OwnerIntentDependencies<"project-index">
    }) {
      if (!sameScope(frame.header.core.scope, input.scope)) return Object.freeze({ status: "rejected" as const })
      return resolve(declaredDependencies)
    },
  })
  const canvasGenesis: ProjectCanvasGenesisStagingPort = Object.freeze({
    async preflightCanvasGenesis() { return "pending" as const },
    async stageCanvasGenesis() { return "pending" as const },
  })
  return Object.freeze({ facts, incomingFacts, canvasGenesis })
}

/** Local blob durability is a Project-owned external fact; paths and filesystem mtimes never satisfy it. */
export function createLocalBlobProjectIndexFactPorts(input: {
  readonly factory: OwnerExternalFactPortFactory<"project-index">
  readonly scope: DocumentScope & { readonly docKind: "project-index" }
  readonly blobs: Pick<ProjectBlobReplicationStore, "queryHave">
}): Readonly<{
  facts: ProjectIndexFactResolutionPort
  incomingFacts: IncomingOwnerFactResolverPort
  canvasGenesis: ProjectCanvasGenesisStagingPort
}> {
  const scope = requireProjectIndexScope(input.scope)
  const resolve = async (dependencies: OwnerIntentDependencies<"project-index">) => {
    if (dependencies.validationArtifacts.length !== 0) return Object.freeze({ status: "pending" as const })
    const facts = new Map<string, unknown>()
    for (const requirement of dependencies.externalFacts) {
      if (requirement.kind !== "blob-publication-currentness") return Object.freeze({ status: "pending" as const })
      const request = decodeProjectIndexBlobPublicationCurrentnessRequest(requirement.request.exactJcs)
      if (
        request === "rejected" ||
        !sameScope(request.projectIndexScope, scope) ||
        ordinarySha256(new Uint8Array(requirement.request.exactJcs)) !== requirement.request.sha256 ||
        requirement.factDigest !== requirement.request.sha256
      ) return Object.freeze({ status: "rejected" as const })
      const have = await input.blobs.queryHave([{ blobSha256: request.blob.digest, byteLength: request.blob.byteLength }])
      if (have.length !== 1 || have[0]?.blobSha256 !== request.blob.digest || have[0]?.byteLength !== request.blob.byteLength) {
        return Object.freeze({ status: "pending" as const })
      }
      facts.set(requirement.factDigest, Object.freeze({
        format: "convax.project-index-external-fact-result",
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
        resolveFact(requirement: OwnerExternalFactRequirement<"project-index">) {
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
    facts: Object.freeze({ resolve: (request: Parameters<ProjectIndexFactResolutionPort["resolve"]>[0]) => resolve(request.dependencies) }),
    incomingFacts: Object.freeze({
      async resolve(request: Parameters<IncomingOwnerFactResolverPort["resolve"]>[0]) {
        if (!sameScope(request.frame.header.core.scope, scope)) return Object.freeze({ status: "rejected" as const })
        return resolve(request.declaredDependencies as OwnerIntentDependencies<"project-index">)
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
 * Current carrier build/validation stays behind the Canvas verifier, while Project owns
 * the request codec and native Project persistence owns the sole durable bytes.
 */
export function createProjectIndexCanvasGenesisFactPorts(input: {
  readonly factory: OwnerExternalFactPortFactory<"project-index">
  readonly scope: DocumentScope & { readonly docKind: "project-index" }
  readonly persistence: Pick<
    NodeCollaborationPersistence,
    "initializeShardWithGenesisProof" | "readGenesisProof"
  >
  readonly genesisVerifier: ProjectDocumentGenesisVerifierPort<"canvas">
  readonly proofVerifier: CanvasGenesisProofCarrierVerifier
  readonly preflightAuthor: (input: {
    readonly projectId: DocumentScope["projectId"]
    readonly projectEpoch: DocumentScope["projectEpoch"]
    readonly signal?: AbortSignal
  }) => Promise<"ready" | "pending" | "rejected">
  readonly withGenesisMaterializer: <Result>(
    scope: DocumentScope & { readonly docKind: "canvas" },
    operation: () => Promise<Result>,
  ) => Promise<Result>
}): Readonly<{
  facts: ProjectIndexFactResolutionPort
  incomingFacts: IncomingOwnerFactResolverPort
  canvasGenesis: ProjectCanvasGenesisStagingPort
}> {
  const projectIndexScope = requireProjectIndexScope(input.scope)

  const resolve = async (
    dependencies: OwnerIntentDependencies<"project-index">,
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
      if (verified.status === "pending") return Object.freeze({ status: "pending" as const })
      const identity = verified.status === "validated"
        ? Object.freeze({
            checkpointObjectDigest: verified.identity.checkpointObjectDigest,
            scope: verified.identity.scope,
            routeDependency: verified.identity.identity.projectIndexRouteDependency,
          })
        : undefined
      if (!identity ||
        identity.checkpointObjectDigest !== request.genesisCheckpointObjectDigest ||
        !sameScope(identity.scope, request.canvasScope) ||
        identity.routeDependency.kind !== request.routeDependency.kind ||
        identity.routeDependency.digest !== request.routeDependency.digest
      ) {
        return Object.freeze({ status: "rejected" as const })
      }
      facts.set(requirement.factDigest, Object.freeze({
        format: "convax.project-index-external-fact-result",
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
        resolveFact(requirement: OwnerExternalFactRequirement<"project-index">) {
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

  const facts: ProjectIndexFactResolutionPort = Object.freeze({
    resolve: (request: Parameters<ProjectIndexFactResolutionPort["resolve"]>[0]) =>
      resolve(request.dependencies, request.signal),
  })
  const incomingFacts: IncomingOwnerFactResolverPort = Object.freeze({
    async resolve(request: Parameters<IncomingOwnerFactResolverPort["resolve"]>[0]) {
      const { frame, declaredDependencies, signal } = request
      if (!sameScope(frame.header.core.scope, projectIndexScope)) {
        return Object.freeze({ status: "rejected" as const })
      }
      if (declaredDependencies.externalFacts.some((requirement) => requirement.owner !== "project-index")) {
        return Object.freeze({ status: "rejected" as const })
      }
      return resolve(declaredDependencies as OwnerIntentDependencies<"project-index">, signal)
    },
  })
  const canvasGenesis: ProjectCanvasGenesisStagingPort = Object.freeze({
    async preflightCanvasGenesis(request: Parameters<ProjectCanvasGenesisStagingPort["preflightCanvasGenesis"]>[0]) {
      if (!sameScope(request.projectIndexScope, projectIndexScope)) return "rejected"
      return input.preflightAuthor({
        projectId: projectIndexScope.projectId,
        projectEpoch: projectIndexScope.projectEpoch,
        signal: request.signal,
      })
    },
    async stageCanvasGenesis(request: Parameters<ProjectCanvasGenesisStagingPort["stageCanvasGenesis"]>[0]) {
      if (!sameProjectEpoch(request.scope, projectIndexScope)) return "rejected"
      const staged = await input.withGenesisMaterializer(request.scope, () =>
        stageDurableProjectDocumentGenesis({
          scope: request.scope,
          predecessor: request.predecessor,
          verifier: input.genesisVerifier,
          store: input.persistence,
          signal: request.signal,
        }))
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
  requirement: OwnerExternalFactRequirement<"project-index">,
  scope: DocumentScope & { readonly docKind: "project-index" },
): ProjectIndexCanvasGenesisCurrentnessRequest | "rejected" {
  if (
    requirement.owner !== "project-index" ||
    requirement.kind !== "canvas-genesis-currentness" ||
    ordinarySha256(new Uint8Array(requirement.request.exactJcs)) !== requirement.request.sha256 ||
    requirement.factDigest !== requirement.request.sha256
  ) return "rejected"
  const request = decodeProjectIndexCanvasGenesisCurrentnessRequest(requirement.request.exactJcs)
  if (request === "rejected" || !sameScope(request.projectIndexScope, scope)) return "rejected"
  return request
}

function requireProjectIndexScope(
  value: DocumentScope,
): DocumentScope & { readonly docKind: "project-index"; readonly docId: "project-index" } {
  const scope = parseDocumentScope(value)
  if (scope.docKind !== "project-index" || scope.docId !== "project-index") {
    throw new TypeError("ProjectIndex genesis facts require a ProjectIndex scope")
  }
  return scope as DocumentScope & { readonly docKind: "project-index"; readonly docId: "project-index" }
}

function sameProjectEpoch(left: DocumentScope, right: DocumentScope): boolean {
  const parsed = parseDocumentScope(left)
  return parsed.docKind === "canvas" && parsed.projectId === right.projectId &&
    parsed.projectEpoch === right.projectEpoch
}

function isMissingGenesis(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error &&
    error.code === "document-not-found"
}

function sameScope(left: DocumentScope, right: DocumentScope): boolean {
  return left.projectId === right.projectId && left.projectEpoch === right.projectEpoch &&
    left.docKind === right.docKind && left.docId === right.docId && left.shardEpoch === right.shardEpoch
}
