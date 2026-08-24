import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import {
  acceptedHeadMaterializedStateDigest,
  causalFrontierDigest,
  createWebCryptoEd25519Verifier,
  encodeFullUpdate,
  encodeStateVector,
  installCurrentProtocolAuthority,
  ordinarySha256,
  parseId128,
  parseProjectId,
  replicaActorHeadSetDigest,
  type AcceptedHeadView,
} from "@convax/collaboration"
import {
  createCanvasDocumentOwnerRuntime,
  createCanvasReconstructionYDoc,
  requiredCanvasBlobDigests,
} from "@convax/canvas/collaboration"
import {
  PROJECT_INDEX_PROTOCOL_SCHEMA_ARTIFACT_DIGEST,
  createProjectIndexReconstructionYDoc,
  projectIndexCanonicalStateCommitmentDigest,
  requiredProjectIndexBlobDigests,
} from "@convax/project"
import { ProjectIndexCanvasApplication } from "@convax/project/canvas"
import { createEmptyProjectIndexGenesisCandidate } from "@convax/project/node"

import {
  createCanvasDocumentGenesisAuthority,
  createCanvasGenesisNodeReplicaHeadMaterializer,
} from "../src/main/canvas-document-genesis"
import { createKernelBackedMainCollaborationDocumentSession } from "../src/main/collaboration-document-session"
import {
  createLocalProjectOwnerCurrentLocalReplicaAuthoritySource,
  createMainCollaborationProductionRuntime,
} from "../src/main/collaboration-production-runtime"
import { ElectronReplicaSigningVault } from "../src/main/electron-replica-signing-vault"
import { NodeDurableLocalProjectOwnerAuthority } from "../src/main/local-project-owner-authority"
import { createLocalProjectOwnerCanvasGenesisAuthority } from "../src/main/local-project-owner-canvas-genesis"
import { createMainCanvasOwnerRuntime } from "../src/main/main-canvas-collaboration-composition"
import { createMainProjectIndexOwnerRuntime } from "../src/main/main-project-index-runtime-registry"
import { createProjectIndexCanvasGenesisFactPorts } from "../src/main/project-index-external-facts"
import {
  BenchmarkBarrierTracker,
  createBenchmarkCountingMaterializerRegistry,
  openBenchmarkNodePersistence,
} from "./project-index-durable-benchmark"

export interface VerifiedCanvasBenchmarkComposition {
  readonly authority: ReturnType<typeof installCurrentProtocolAuthority>
  readonly scope: AcceptedHeadView["scope"] & { readonly docKind: "canvas" }
  readonly acceptedBase: AcceptedHeadView
  readonly actorId: ReturnType<typeof createEmptyProjectIndexGenesisCandidate>["document"] extends never
    ? never
    : import("@convax/collaboration").ActorId
  readonly localAuthority: ReturnType<typeof createLocalProjectOwnerCurrentLocalReplicaAuthoritySource>
  readonly persistence: Awaited<ReturnType<typeof openBenchmarkNodePersistence>>
  readonly materializers: ReturnType<typeof createBenchmarkCountingMaterializerRegistry>["registry"]
  readonly materializerApplyCount: () => number
  readonly barrierTracker: BenchmarkBarrierTracker
  readonly canvasOwner: ReturnType<typeof createMainCanvasOwnerRuntime>
  readonly canvasRuntime: Awaited<ReturnType<typeof createMainCollaborationProductionRuntime<"canvas">>>
  readonly scopes: readonly (AcceptedHeadView["scope"] & { readonly docKind: "canvas" })[]
  readonly acceptedBases: readonly AcceptedHeadView[]
  readonly canvasRuntimes: readonly Awaited<ReturnType<typeof createMainCollaborationProductionRuntime<"canvas">>>[]
  readonly root: string
  dispose(): Promise<void>
}

/** Benchmark-only composition of the real ProjectIndex F -> Canvas G -> activation chain. */
export async function createVerifiedCanvasBenchmarkComposition(
  input: {
    readonly canvasCount?: 1 | 8 | 32
    readonly onOwnerFullValidate?: () => void
    readonly onOwnerCanonicalState?: () => void
  } = {},
): Promise<VerifiedCanvasBenchmarkComposition> {
  const authority = installCurrentProtocolAuthority()
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "convax-canvas-benchmark-composition-"))
  const projectRoot = path.join(root, "project")
  await fs.mkdir(path.join(projectRoot, ".convax"), { recursive: true })
  const projectId = parseProjectId("canvas-benchmark-project")
  const vault = new ElectronReplicaSigningVault(path.join(root, "keys"))
  let nextId = 10
  const id = () => parseId128(Buffer.alloc(16, nextId++).toString("base64url"))
  const durableOwner = new NodeDurableLocalProjectOwnerAuthority({
    rootDirectory: path.join(root, "owners"),
    authority,
    schemaDigest: PROJECT_INDEX_PROTOCOL_SCHEMA_ARTIFACT_DIGEST,
    projects: { resolveProjectRoot: async () => projectRoot },
    vault,
    verifier: createWebCryptoEd25519Verifier(),
    createId: id,
  })
  const resolvedOwner = await durableOwner.ensureForDurableProject({ projectId, projectRoot })
  const binding = resolvedOwner.binding
  const projectScope = Object.freeze({
    projectId,
    projectEpoch: binding.projectEpoch,
    docKind: "project-index" as const,
    docId: "project-index" as const,
    shardEpoch: id(),
  })
  const projectOwner = createMainProjectIndexOwnerRuntime(authority)
  const candidate = createEmptyProjectIndexGenesisCandidate({
    scope: projectScope,
    actorId: binding.actorId,
    operationId: id(),
    checkpointId: binding.genesisCheckpointId,
    authorMemberId: binding.memberId,
    authorReplicaId: binding.replicaId,
    authorAuthorizationDigest: binding.bindingDigest,
    validationArtifactSetDigest: binding.validationArtifactSetDigest,
    authority: {
      protocolDigest: authority.protocolDigest,
      schemaDigest: PROJECT_INDEX_PROTOCOL_SCHEMA_ARTIFACT_DIGEST,
      uriProtocolDigest: authority.protocolSchemaBundle.core.uriProtocolDigest,
    },
  })
  const acceptedBase = initialHead(
    projectOwner,
    projectScope,
    candidate.document,
    projectIndexCanonicalStateCommitmentDigest(candidate.document, authority),
  )
  candidate.document.destroy()
  const materializerCounter = createBenchmarkCountingMaterializerRegistry(authority)
  const materializers = materializerCounter.registry
  const tracker = new BenchmarkBarrierTracker()
  const persistence = await openBenchmarkNodePersistence(root, acceptedBase, materializers, tracker, binding.actorId)
  const localAuthority = createLocalProjectOwnerCurrentLocalReplicaAuthoritySource({
    protocolDigest: authority.protocolDigest,
    resolveOwner: async (scope) =>
      scope.projectId === projectId && scope.projectEpoch === binding.projectEpoch ? resolvedOwner : "rejected",
  })
  const canvasOwner =
    input.onOwnerFullValidate || input.onOwnerCanonicalState
      ? createObservedCanvasOwnerRuntime(authority, input)
      : createMainCanvasOwnerRuntime(authority)
  const canvasGenesisAuthor = createLocalProjectOwnerCanvasGenesisAuthority({
    authority,
    resolveOwner: async ({ projectId: requestedProject, projectEpoch }) =>
      requestedProject === projectId && projectEpoch === binding.projectEpoch ? resolvedOwner : "rejected",
  })
  const canvasGenesis = createCanvasDocumentGenesisAuthority({
    authority,
    runtime: canvasOwner,
    historicalAuthorVerifier: canvasGenesisAuthor.historicalAuthorVerifier,
    authorProvider: canvasGenesisAuthor.authorProvider,
  })
  const genesisFacts = createProjectIndexCanvasGenesisFactPorts({
    factory: projectOwner.externalFactPortFactory,
    scope: projectScope,
    persistence,
    genesisVerifier: canvasGenesis.genesisVerifier,
    proofVerifier: canvasGenesis.proofVerifier,
    preflightAuthor: canvasGenesis.preflight,
    async withGenesisMaterializer(scope, operation) {
      const release = materializers.register({
        scope,
        materializer: createCanvasGenesisNodeReplicaHeadMaterializer({ authority, runtime: canvasOwner, scope }),
      })
      try {
        return await operation()
      } finally {
        release()
      }
    },
  })
  const projectRuntime = await createMainCollaborationProductionRuntime({
    authority,
    scope: projectScope,
    owner: projectOwner,
    actorId: binding.actorId,
    localAuthority,
    incomingAuthority: { verify: async () => "rejected" as const },
    incomingFacts: genesisFacts.incomingFacts,
    createDocument: createProjectIndexReconstructionYDoc,
    requiredBlobDigests: requiredProjectIndexBlobDigests,
    persistence,
    materializers,
  })
  const projectSession = await createKernelBackedMainCollaborationDocumentSession({
    authority,
    scope: projectScope,
    owner: projectOwner,
    ports: projectRuntime.ports,
    signatureVerifier: { verify: async () => true },
    createOperationId: id,
  })
  const application = new ProjectIndexCanvasApplication({
    session: projectSession,
    facts: genesisFacts.facts,
    genesis: genesisFacts.canvasGenesis,
    createOperationId: id,
    createShardEpoch: id,
  })
  const scopes: (AcceptedHeadView["scope"] & { readonly docKind: "canvas" })[] = []
  const canvasRuntimes: Awaited<ReturnType<typeof createMainCollaborationProductionRuntime<"canvas">>>[] = []
  const acceptedBases: AcceptedHeadView[] = []
  for (let index = 0; index < (input.canvasCount ?? 1); index += 1) {
    const created = await application.submitRouteCommand({
      projectId,
      command: {
        format: "convax.project-canvas-route-command",
        kind: "project.canvas.route.create",
        title: `Canvas duplicate benchmark ${index + 1}`,
      },
    })
    if (created.status !== "committed") throw new Error(`Canvas benchmark route composition was ${created.code}`)
    const route = created.catalog.visibleCanvases.find(({ canvasId }) => canvasId === created.canvasId)
    if (!route?.shardEpoch) throw new Error("Canvas benchmark route activation is not live")
    const scope = Object.freeze({
      projectId,
      projectEpoch: binding.projectEpoch,
      docKind: "canvas" as const,
      docId: created.canvasId,
      shardEpoch: route.shardEpoch,
    })
    const canvasRuntime = await createMainCollaborationProductionRuntime({
      authority,
      scope,
      owner: canvasOwner,
      actorId: binding.actorId,
      localAuthority,
      incomingAuthority: { verify: async () => "rejected" as const },
      incomingFacts: { resolve: async () => Object.freeze({ status: "rejected" as const }) },
      createDocument: createCanvasReconstructionYDoc,
      requiredBlobDigests: requiredCanvasBlobDigests,
      persistence,
      materializers,
    })
    scopes.push(scope)
    canvasRuntimes.push(canvasRuntime)
    acceptedBases.push(await persistence.loadReplicaHead(scope))
  }
  const uniqueScopes = new Set(scopes.map(({ docId, shardEpoch }) => `${docId}\0${shardEpoch}`))
  if (uniqueScopes.size !== scopes.length) throw new Error("Canvas benchmark scopes are not unique")
  projectSession.dispose()
  projectRuntime.dispose()
  const scope = scopes[0]!
  const canvasRuntime = canvasRuntimes[0]!
  const canvasAcceptedBase = acceptedBases[0]!
  return Object.freeze({
    authority,
    scope,
    acceptedBase: canvasAcceptedBase,
    actorId: binding.actorId,
    localAuthority,
    persistence,
    materializers,
    materializerApplyCount: materializerCounter.applyCount,
    barrierTracker: tracker,
    canvasOwner,
    canvasRuntime,
    scopes: Object.freeze(scopes),
    acceptedBases: Object.freeze(acceptedBases),
    canvasRuntimes: Object.freeze(canvasRuntimes),
    root,
    async dispose() {
      for (const runtime of canvasRuntimes) runtime.dispose()
      persistence.dispose()
      await fs.rm(root, { recursive: true, force: true })
    },
  })
}

function createObservedCanvasOwnerRuntime(
  authority: ReturnType<typeof installCurrentProtocolAuthority>,
  input: { readonly onOwnerFullValidate?: () => void; readonly onOwnerCanonicalState?: () => void },
) {
  return createCanvasDocumentOwnerRuntime(authority, {
    record(event) {
      if (event === "full-validation") input.onOwnerFullValidate?.()
      else input.onOwnerCanonicalState?.()
    },
  })
}

function initialHead(
  owner: ReturnType<typeof createMainProjectIndexOwnerRuntime>,
  scope: Parameters<typeof createEmptyProjectIndexGenesisCandidate>[0]["scope"],
  document: ReturnType<typeof createEmptyProjectIndexGenesisCandidate>["document"],
  canonicalStateCommitmentDigest: AcceptedHeadView["canonicalStateDigest"],
): AcceptedHeadView {
  const frontier = Object.freeze({ format: "convax.causal-frontier" as const, heads: Object.freeze([]) })
  const validated = owner.protocolPort.validateBase(document)
  if (validated === "rejected") throw new Error("Canvas benchmark ProjectIndex genesis was rejected")
  const headDigest = ordinarySha256(new TextEncoder().encode("canvas-benchmark-project-index-genesis"))
  const fullUpdate = encodeFullUpdate(document)
  const stateVector = encodeStateVector(document)
  const base = Object.freeze({
    scope,
    headDigest,
    frontier,
    frontierDigest: causalFrontierDigest(frontier),
    actorHeads: Object.freeze({ format: "convax.replica-actor-head-set" as const, scope, heads: Object.freeze([]) }),
    fullUpdate,
    stateVector,
    canonicalStateDigest: canonicalStateCommitmentDigest,
    materializationDigest: headDigest,
  })
  return Object.freeze({ ...base, materializationDigest: acceptedHeadMaterializedStateDigest(base) })
}
