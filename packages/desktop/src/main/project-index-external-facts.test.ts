import { describe, expect, mock, test } from "bun:test"
import {
  encodeRestrictedJcsV2,
  ordinarySha256V2,
  parseActorIdV2,
  parseCanvasIdV2,
  parseId128V2,
  parseProjectIdV2,
  type DecodedCausalEditFrameV2,
  type DigestV2,
  type DocumentScopeV2,
  type OwnerExternalFactPortFactoryV2,
  type OwnerExternalFactPortV2,
  type StateVectorV2,
} from "@convax/collaboration"
import type { CanvasGenesisProofCarrierVerifierV2 } from "@convax/canvas/collaboration"

import type { ProjectDocumentGenesisVerifierPortV2 } from "@convax/project/node"
import {
  createFailClosedProjectIndexFactPortsV2,
  createLocalBlobProjectIndexFactPortsV2,
  createProjectIndexCanvasGenesisFactPortsV2,
} from "./project-index-external-facts"

describe("ProjectIndex fail-closed production fact ports", () => {
  test("creates an attempt port for dependency-free query/history and keeps Canvas genesis pending", async () => {
    const port = Object.freeze({ marker: "project-index-port" }) as unknown as OwnerExternalFactPortV2<"project-index">
    const factory = {
      createAttemptPort() { return { status: "created" as const, port } },
    } as unknown as OwnerExternalFactPortFactoryV2<"project-index">
    const adapters = createFailClosedProjectIndexFactPortsV2({ factory, scope: scope() })
    await expect(adapters.facts.resolve({ dependencies: { validationArtifacts: [], externalFacts: [] } }))
      .resolves.toEqual({ status: "resolved", port })
    await expect(adapters.canvasGenesis.stageCanvasGenesis({} as never)).resolves.toBe("pending")
    await expect(adapters.canvasGenesis.preflightCanvasGenesis({ projectIndexScope: scope() }))
      .resolves.toBe("pending")
  })

  test("keeps authority-bearing ProjectIndex mutation pending and rejects cross-scope incoming frames", async () => {
    const factory = { createAttemptPort() { throw new Error("must not create") } } as unknown as OwnerExternalFactPortFactoryV2<"project-index">
    const adapters = createFailClosedProjectIndexFactPortsV2({ factory, scope: scope() })
    const requirement = {
      owner: "project-index" as const, kind: "blob-publication-currentness", factDigest: "a".repeat(64) as never,
      request: { sha256: "b".repeat(64) as never, exactJcs: new Uint8Array([1]) },
    }
    await expect(adapters.facts.resolve({ dependencies: { validationArtifacts: [], externalFacts: [requirement] } }))
      .resolves.toEqual({ status: "pending" })
    const frame = { header: { core: { scope: { ...scope(), projectId: "another" } } } } as never
    await expect(adapters.incomingFacts.resolve({ frame, declaredDependencies: { validationArtifacts: [], externalFacts: [] } }))
      .resolves.toEqual({ status: "rejected" })
  })

  test("resolves blob publication only from exact durable presence", async () => {
    const request = {
      format: "convax.project-index-external-fact-request/2",
      kind: "blob-publication-currentness",
      projectIndexScope: scope(),
      operationId: id(3),
      intentDigest: digest("intent"),
      versionRecordDigest: digest("version"),
      blob: { format: "convax.blob-ref/2", algorithm: "sha256", digest: digest("blob"), byteLength: "7", mime: "text/plain" },
    } as const
    const exactJcs = encodeRestrictedJcsV2(request)
    const factDigest = ordinarySha256V2(exactJcs)
    const requirement = { owner: "project-index" as const, kind: request.kind, factDigest, request: { sha256: factDigest, exactJcs } }
    const factory = {
      createAttemptPort({ resolver }: { resolver: { resolveFact(requirement: unknown): unknown } }) {
        return { status: "created" as const, port: { resolveFact: (value: unknown) => resolver.resolveFact(value) } }
      },
    } as unknown as OwnerExternalFactPortFactoryV2<"project-index">
    const queryHave = mock(async () => [{ blobSha256: request.blob.digest, byteLength: request.blob.byteLength }])
    const ports = createLocalBlobProjectIndexFactPortsV2({ factory, scope: scope(), blobs: { queryHave } as never })
    const resolved = await ports.facts.resolve({ dependencies: { validationArtifacts: [], externalFacts: [requirement] } })
    expect(resolved.status).toBe("resolved")
    if (resolved.status !== "resolved") throw new Error("expected local blob fact")
    expect(resolved.port.resolveFact(requirement)).toMatchObject({ status: "resolved", value: { decision: "verified" } })
    expect(queryHave).toHaveBeenCalledWith([{ blobSha256: request.blob.digest, byteLength: "7" }])
  })

  test("stages Canvas genesis durably and verifies the same CVXCGP02 identity for activation", async () => {
    const fixture = productionFixture()
    const first = await fixture.ports.canvasGenesis.stageCanvasGenesis(fixture.stageRequest)
    const retry = await fixture.ports.canvasGenesis.stageCanvasGenesis(fixture.stageRequest)
    expect(first).toEqual(retry)
    expect(fixture.initializeShardWithGenesisProof).toHaveBeenCalledTimes(2)
    expect(first).toEqual({
      predecessorFrameDigest: fixture.stageFrameDigest,
      stagedProjectIndexFrontierDigest: fixture.stageFrontierDigest,
      checkpointObjectDigest: fixture.checkpointObjectDigest,
    })

    const resolved = await fixture.ports.facts.resolve({ dependencies: fixture.dependencies })
    expect(resolved.status).toBe("resolved")
    if (resolved.status !== "resolved") throw new Error("expected resolved Canvas genesis fact")
    expect(resolved.port.resolveFact(fixture.requirement)).toEqual({
      status: "resolved",
      requirement: fixture.requirement,
      value: {
        format: "convax.project-index-external-fact-result/2",
        kind: "canvas-genesis-currentness",
        requestSha256: fixture.requirement.request.sha256,
        factDigest: fixture.requirement.factDigest,
        decision: "verified",
      },
    })
  })

  test("activates an exact V3 local-owner Canvas proof when the frozen V2 verifier rejects it", async () => {
    const fixture = productionFixture({ localOwnerV3: true })
    await fixture.ports.canvasGenesis.stageCanvasGenesis(fixture.stageRequest)

    const resolved = await fixture.ports.facts.resolve({ dependencies: fixture.dependencies })

    expect(resolved.status).toBe("resolved")
    expect(fixture.localOwnerProofVerifierV3).toHaveBeenCalledTimes(1)
    if (resolved.status !== "resolved") throw new Error("expected resolved V3 Canvas genesis fact")
    expect(resolved.port.resolveFact(fixture.requirement)).toMatchObject({
      status: "resolved",
      value: { kind: "canvas-genesis-currentness", decision: "verified" },
    })
  })

  test("leaves a missing durable G pending and rejects F or scope substitution", async () => {
    const missing = productionFixture({ missingProof: true })
    await expect(missing.ports.facts.resolve({ dependencies: missing.dependencies }))
      .resolves.toEqual({ status: "pending" })

    const wrongF = productionFixture({ proofFrameDigest: digest("another-stage-frame") })
    await wrongF.ports.canvasGenesis.stageCanvasGenesis(wrongF.stageRequest)
    await expect(wrongF.ports.facts.resolve({ dependencies: wrongF.dependencies }))
      .resolves.toEqual({ status: "rejected" })

    const crossed = productionFixture()
    await expect(crossed.ports.canvasGenesis.stageCanvasGenesis({
      ...crossed.stageRequest,
      scope: { ...crossed.stageRequest.scope, projectId: parseProjectIdV2("other") },
    })).resolves.toBe("rejected")
    expect(crossed.prepareGenesis).not.toHaveBeenCalled()
  })

  test("can retry the exact genesis after a crash before shard publication", async () => {
    const fixture = productionFixture({ failFirstInitialization: true })
    await expect(fixture.ports.canvasGenesis.stageCanvasGenesis(fixture.stageRequest))
      .rejects.toThrow("simulated crash")
    await expect(fixture.ports.canvasGenesis.stageCanvasGenesis(fixture.stageRequest))
      .resolves.toEqual({
        predecessorFrameDigest: fixture.stageFrameDigest,
        stagedProjectIndexFrontierDigest: fixture.stageFrontierDigest,
        checkpointObjectDigest: fixture.checkpointObjectDigest,
      })
    expect(fixture.initializeShardWithGenesisProof).toHaveBeenCalledTimes(2)
  })

  test("keeps an unteamed Project pending before any Canvas-store write", async () => {
    const fixture = productionFixture({ authorPending: true })
    await expect(fixture.ports.canvasGenesis.preflightCanvasGenesis({ projectIndexScope: scope() }))
      .resolves.toBe("pending")
    expect(fixture.initializeShardWithGenesisProof).not.toHaveBeenCalled()
    expect(fixture.prepareGenesis).not.toHaveBeenCalled()
  })
})

function scope() {
  return {
    projectId: "project" as never,
    projectEpoch: "AQEBAQEBAQEBAQEBAQEBAQ" as never,
    docKind: "project-index" as const,
    docId: "project-index" as const,
    shardEpoch: "AgICAgICAgICAgICAgICAg" as never,
  }
}

function productionFixture(options: {
  readonly missingProof?: boolean
  readonly proofFrameDigest?: DigestV2
  readonly failFirstInitialization?: boolean
  readonly authorPending?: boolean
  readonly localOwnerV3?: boolean
} = {}) {
  const projectIndexScope = scope()
  const canvasScope = {
    projectId: projectIndexScope.projectId,
    projectEpoch: projectIndexScope.projectEpoch,
    docKind: "canvas" as const,
    docId: parseCanvasIdV2(`cv_${"c".repeat(64)}`),
    shardEpoch: id(9),
  }
  const stageFrameDigest = digest("stage-frame")
  const stageFrontierDigest = digest("stage-frontier")
  const checkpointObjectDigest = digest("canvas-genesis")
  const acceptedBase = Object.freeze({
    scope: canvasScope,
    frontier: Object.freeze({ format: "convax.causal-frontier/2" as const, heads: Object.freeze([]) }),
    frontierDigest: digest("empty-frontier"),
    actorHeads: Object.freeze({
      format: "convax.replica-actor-head-set/2" as const,
      scope: canvasScope,
      heads: Object.freeze([]),
    }),
    fullUpdate: new Uint8Array([1, 2, 3]),
    stateVector: new Uint8Array([4, 5]) as StateVectorV2,
    canonicalStateDigest: digest("canonical"),
  })
  const checkpointBytes = new Uint8Array([6, 7])
  const carrierBytes = new TextEncoder().encode("CVXCGP02-test")
  const prepareGenesis = mock(async () => Object.freeze({
    status: "verified" as const,
    candidate: Object.freeze({
      scope: canvasScope,
      checkpointObjectDigest,
      checkpointExactBytes: checkpointBytes,
      proofCarrierExactBytes: carrierBytes,
      acceptedBase,
    }),
  }))
  const genesisVerifier: ProjectDocumentGenesisVerifierPortV2<"canvas"> = { prepare: prepareGenesis }
  let initializationAttempt = 0
  let installed = false
  const initializeShardWithGenesisProof = mock(async (input: Parameters<
    import("@convax/project/node").NodeCollaborationPersistenceV2["initializeShardWithGenesisProof"]
  >[0]) => {
    initializationAttempt += 1
    if (options.failFirstInitialization && initializationAttempt === 1) throw new Error("simulated crash")
    installed = true
    return Object.freeze({ ...input.acceptedBase, headDigest: digest("durable-head") })
  })
  const persistence = {
    initializeShardWithGenesisProof,
    async readGenesisProof(requestScope: DocumentScopeV2, requestDigest: DigestV2) {
      if (
        options.missingProof || !installed ||
        !sameTestScope(requestScope, canvasScope) || requestDigest !== checkpointObjectDigest
      ) {
        throw Object.assign(new Error("missing"), { code: "document-not-found" })
      }
      return new Uint8Array(carrierBytes)
    },
  }
  const proofVerifier = ((exactBytes: Readonly<Uint8Array>) => {
    expect(exactBytes).toEqual(carrierBytes)
    if (options.localOwnerV3) return Object.freeze({ status: "rejected" as const })
    return Object.freeze({
      status: "validated" as const,
      exactBytesSha256: ordinarySha256V2(exactBytes),
      canvasArtifactDigest: digest("canvas-artifact"),
      identity: Object.freeze({
        checkpointObjectDigest,
        scope: canvasScope,
        identity: Object.freeze({
          projectIndexRouteDependencyFrameDigest: options.proofFrameDigest ?? stageFrameDigest,
        }),
        authorActorId: parseActorIdV2(Buffer.alloc(32, 3).toString("base64url")),
        authorCredentialCoreDigest: digest("credential"),
      }),
    })
  }) as unknown as CanvasGenesisProofCarrierVerifierV2
  const localOwnerProofVerifierV3 = mock(async (exactBytes: Uint8Array) => {
    expect(exactBytes).toEqual(carrierBytes)
    return Object.freeze({
      status: "validated" as const,
      proofDigest: digest("v3-proof"),
      checkpointObjectDigest,
      scope: canvasScope,
      projectIndexRouteDependencyFrameDigest: options.proofFrameDigest ?? stageFrameDigest,
    })
  })
  const factory = attemptFactory()
  const ports = createProjectIndexCanvasGenesisFactPortsV2({
    factory,
    scope: projectIndexScope,
    persistence,
    genesisVerifier,
    proofVerifier,
    ...(options.localOwnerV3 ? { localOwnerProofVerifierV3 } : {}),
    preflightAuthor: async () => options.authorPending ? "pending" : "ready",
  })
  const stageFrame = {
    frameDigest: stageFrameDigest,
    header: { core: { scope: projectIndexScope } },
  } as unknown as DecodedCausalEditFrameV2
  const stageRequest = Object.freeze({
    scope: canvasScope,
    predecessor: Object.freeze({ frame: stageFrame, acceptedFrontierDigest: stageFrontierDigest }),
  })
  const request = Object.freeze({
    format: "convax.project-index-external-fact-request/2",
    kind: "canvas-genesis-currentness",
    projectIndexScope,
    operationId: id(10),
    intentDigest: digest("activation-intent"),
    canvasScope,
    stageRecordDigest: digest("stage-record"),
    routeDependencyFrameDigest: stageFrameDigest,
    genesisCheckpointObjectDigest: checkpointObjectDigest,
    stagedProjectIndexFrontierDigest: stageFrontierDigest,
  })
  const exactJcs = encodeRestrictedJcsV2(request)
  const sha256 = ordinarySha256V2(exactJcs)
  const requirement = Object.freeze({
    owner: "project-index" as const,
    kind: "canvas-genesis-currentness",
    factDigest: sha256,
    request: Object.freeze({ sha256, exactJcs }),
  })
  const dependencies = Object.freeze({
    validationArtifacts: Object.freeze([]),
    externalFacts: Object.freeze([requirement]),
  })
  return {
    ports,
    stageRequest,
    stageFrameDigest,
    stageFrontierDigest,
    checkpointObjectDigest,
    requirement,
    dependencies,
    initializeShardWithGenesisProof,
    prepareGenesis,
    localOwnerProofVerifierV3,
  }
}

function attemptFactory(): OwnerExternalFactPortFactoryV2<"project-index"> {
  return {
    createAttemptPort(request: Parameters<OwnerExternalFactPortFactoryV2<"project-index">["createAttemptPort"]>[0]) {
      const { declared, resolver } = request
      const port = Object.freeze({
        resolveArtifact: resolver.resolveArtifact.bind(resolver),
        resolveFact: resolver.resolveFact.bind(resolver),
        consumedDependencies: () => declared,
      }) as unknown as OwnerExternalFactPortV2<"project-index">
      return Object.freeze({ status: "created" as const, port })
    },
  } as unknown as OwnerExternalFactPortFactoryV2<"project-index">
}

function digest(value: string): DigestV2 {
  return ordinarySha256V2(new TextEncoder().encode(value))
}

function id(value: number) {
  return parseId128V2(Buffer.alloc(16, value).toString("base64url"))
}

function sameTestScope(left: DocumentScopeV2, right: DocumentScopeV2): boolean {
  return left.projectId === right.projectId && left.projectEpoch === right.projectEpoch &&
    left.docKind === right.docKind && left.docId === right.docId && left.shardEpoch === right.shardEpoch
}
