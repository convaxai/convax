import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import {
  applyYjsUpdate,
  acceptedHeadMaterializedStateDigest,
  causalFrontierDigest,
  decodeCausalEditFrame,
  encodeBase64url,
  encodeFullUpdate,
  encodeStateVector,
  installCurrentProtocolAuthority,
  ordinarySha256,
  parseActorId,
  parseId128,
  parseMemberId,
  parseProjectId,
  parseReplicaId,
  parseSignature,
  parseUint64,
  replicaActorHeadSetDigest,
  validateAcceptedHeadMaterializationEvidence,
  type AcceptedHeadView,
  type CollaborationKernelPorts,
  type CollaborationLatencyDiagnostic,
  type CollaborationPersistencePort,
  type CurrentProtocolAuthority,
  type Digest,
  type FrameObjectRef,
  type LocalFrameAuthority,
  type OperationLookup,
  type ValidationArtifactSet,
} from "@convax/collaboration"
import {
  PROJECT_INDEX_PROTOCOL_SCHEMA_ARTIFACT_DIGEST,
  projectIndexCanonicalStateCommitmentDigest,
  requiredProjectIndexBlobDigests,
  createProjectIndexReconstructionYDoc,
} from "@convax/project"
import { ProjectIndexFileApplication } from "@convax/project/canvas"
import {
  createEmptyProjectIndexGenesisCandidate,
  NodeCollaborationPersistence,
  populateProjectIndexBenchmarkFixture,
  type NodeLocalCommitDurabilityDiagnostics,
  type NodeLocalCommitDurabilityMeasurement,
} from "@convax/project/node"

import {
  createKernelBackedMainCollaborationDocumentSession,
  createMainCollaborationLatencyDiagnosticsPort,
} from "../src/main/collaboration-document-session"
import {
  createMainCollaborationProductionRuntime,
  createProjectCollaborationMaterializerRegistry,
  type MainCollaborationProductionRuntime,
  type ProjectCollaborationMaterializerRegistry,
} from "../src/main/collaboration-production-runtime"
import type { CurrentLocalReplicaAuthoritySource } from "../src/main/collaboration-authority-ports"
import { createLocalBlobProjectIndexFactPorts } from "../src/main/project-index-external-facts"
import { createMainProjectIndexOwnerRuntime } from "../src/main/main-project-index-runtime-registry"

export type Mode = "no-op" | "real"
export type ProjectIndexBenchmarkProgressBoundary =
  | "fixture-build"
  | "store-setup"
  | "retained-setup"
  | "warm-preflight"
  | "timed-commit"
export type ProjectIndexBenchmarkProgress = Readonly<{
  boundary: ProjectIndexBenchmarkProgressBoundary
  phase: "start" | "end"
  elapsedMs: number
  durationMs?: number
}>
type ResourceCount = 1 | 32 | 128 | 512 | 2048
type RetainedFrameCount = 1 | 32 | 128 | 512
type CanvasCount = 1 | 8 | 32
type BenchmarkOperation = "new-text" | "new-image" | "ordinary-canvas-duplicate"
const smokeResources = [1, 32] as const
const fullResources = [1, 32, 128, 512, 2048] as const
const smokeRetainedFrames = [1] as const
const fullRetainedFrames = [1, 32, 128, 512] as const
const smokeCanvasCounts = [1] as const
const fullCanvasCounts = [1, 8, 32] as const
const allOperations = ["new-text", "new-image", "ordinary-canvas-duplicate"] as const
const durabilityStages = ["accepted-frame-wal"] as const
export const durableBusinessStages = [
  "queue",
  "operation-lookup",
  "head-check",
  "prepare/facts",
  "candidate-clone",
  "reducer",
  "validate",
  "canonicalize",
  "state-encode",
  "sign",
  "atomic-accepted-frame-commit",
  "replica-apply",
  "projection",
] as const
type DurableBusinessStage = (typeof durableBusinessStages)[number]
type Distribution = Readonly<{ p50: number; p95: number; p99: number }>
const encoder = new TextEncoder()
const actorId = parseActorId(encodeBase64url(new Uint8Array(32).fill(7)))
const replicaId = parseReplicaId("replica_00000007")
const signature = parseSignature(
  encodeBase64url(Uint8Array.from({ length: 64 }, (_, index) => (index === 0 || index === 32 ? 2 : 0))),
)

export interface ProjectIndexBenchmarkCellResult {
  readonly mode: Mode
  readonly resources: ResourceCount
  readonly retainedFrames: RetainedFrameCount
  readonly canvasCount: CanvasCount
  readonly operation: Exclude<BenchmarkOperation, "ordinary-canvas-duplicate">
  readonly temperature: "cold" | "warm"
  readonly sampleCount: number
  readonly fullUpdateBytes: number
  readonly successfulSemanticRoots: number
  readonly semanticRoots: readonly Digest[]
  readonly roots: Readonly<{ projectIndex: readonly Digest[]; canvases: readonly Digest[] }>
  readonly actual: Readonly<{
    resources: number
    operations: number
    retainedFrames: number
    retainedFramesAfterTimedCommit: number
    canvasCount: number
  }>
  readonly totalMs: Distribution
  readonly stages: Readonly<
    Record<
      DurableBusinessStage,
      Readonly<{
        durationMs: Distribution
        callCount: number
        processedSetSizes: Readonly<{ resources: number; retainedFrames: number; canvasCount: number; bytes: number }>
      }>
    >
  >
  readonly kernelDurabilityStages: Readonly<
    Record<"accepted-frame-wal", Readonly<{ durationMs: Distribution; callCount: number }>>
  >
  readonly durability: Readonly<{
    physicalSyncCount: number
    barriers: readonly Readonly<{ kind: string; stage: string; durationMs: Distribution; callCount: number }>[]
  }>
}

export interface ProjectIndexBenchmarkReport {
  readonly metadata: Readonly<{
    benchmark: "project-index"
    matrix: "smoke" | "full" | "custom"
    boundaries: readonly string[]
    temperature: Readonly<Record<"cold" | "warm", string>>
    durability: Readonly<Record<Mode, string>>
    setupExcludedFromTiming: true
  }>
  readonly cells: readonly ProjectIndexBenchmarkCellResult[]
  readonly unsupported: readonly Readonly<{
    operation: BenchmarkOperation
    canvasCount: CanvasCount
    code: "public-benchmark-composition-unavailable"
    missingCapability: string
  }>[]
  readonly complexity: Readonly<
    Record<
      "resources-32-to-512" | "retained-frames-32-to-512" | "canvas-count-1-to-32",
      Readonly<{
        status: "available" | "unsupported"
        ratios: Readonly<Record<string, number>>
        slopes: Readonly<Record<string, number>>
        reason?: string
      }>
    >
  >
}

function benchmarkMetadata(input: {
  readonly resources?: readonly ResourceCount[]
  readonly full?: boolean
}): ProjectIndexBenchmarkReport["metadata"] {
  return Object.freeze({
    benchmark: "project-index" as const,
    matrix: input.resources ? ("custom" as const) : input.full ? ("full" as const) : ("smoke" as const),
    boundaries: Object.freeze([
      "ProjectIndex baseline uses the production owner/kernel",
      "Canvas business cells are explicit unsupported results until a public benchmark composition can bind independent ProjectIndex and Canvas shards",
    ]),
    temperature: Object.freeze({
      cold: "process-cold only: timed commit uses a newly reopened Kernel/runtime over the completed setup base; this is not an OS cold-cache claim",
      warm: "queue-free process-warm: timed commit reuses the setup kernel/runtime after all prior commands settle, performs one owner query, and yields one event-loop turn for bounded rebuildable accelerators before timing",
    }),
    durability: Object.freeze({
      "no-op": "real Kernel and ProjectIndex owner with in-memory barrier-shaped persistence",
      real: "production NodeCollaborationPersistence and production materializer wiring with one atomic WAL fsync barrier",
    }),
    setupExcludedFromTiming: true as const,
  })
}

/** Strict reader for persisted benchmark cells. It intentionally rejects stage drift. */
export function assertProjectIndexBenchmarkCell(value: unknown): asserts value is ProjectIndexBenchmarkCellResult {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new TypeError("Benchmark cell must be an object")
  const cell = value as Record<string, unknown>
  if (!cell.stages || typeof cell.stages !== "object" || Array.isArray(cell.stages))
    throw new TypeError("Benchmark cell stages must be an object")
  const actual = Object.keys(cell.stages as object).sort()
  const expected = [...durableBusinessStages].sort()
  if (actual.length !== expected.length || actual.some((stage, index) => stage !== expected[index])) {
    throw new TypeError("Benchmark cell contains an unknown or missing closed stage")
  }
  for (const stage of expected) {
    const measurement = (cell.stages as Record<string, unknown>)[stage]
    if (!measurement || typeof measurement !== "object" || Array.isArray(measurement))
      throw new TypeError(`Benchmark stage ${stage} must be an object`)
    const record = measurement as Record<string, unknown>
    if (!Number.isSafeInteger(record.callCount) || (record.callCount as number) < 0)
      throw new TypeError(`Benchmark stage ${stage} callCount must be a non-negative safe integer`)
    if (!record.durationMs || typeof record.durationMs !== "object" || Array.isArray(record.durationMs))
      throw new TypeError(`Benchmark stage ${stage} duration distribution is required`)
    const quantiles = record.durationMs as Record<string, unknown>
    if (
      Object.keys(quantiles).sort().join(",") !== "p50,p95,p99" ||
      [quantiles.p50, quantiles.p95, quantiles.p99].some(
        (entry) => typeof entry !== "number" || !Number.isFinite(entry) || entry < 0,
      )
    )
      throw new TypeError(`Benchmark stage ${stage} duration distribution is invalid`)
    if (
      !record.processedSetSizes ||
      typeof record.processedSetSizes !== "object" ||
      Array.isArray(record.processedSetSizes)
    )
      throw new TypeError(`Benchmark stage ${stage} processed sizes are required`)
  }
}

export async function runProjectIndexDurableBenchmark(
  input: {
    readonly samples?: number
    readonly full?: boolean
    readonly resources?: readonly ResourceCount[]
    readonly retainedFrames?: readonly RetainedFrameCount[]
    readonly canvasCounts?: readonly CanvasCount[]
    readonly operations?: readonly BenchmarkOperation[]
    readonly modes?: readonly Mode[]
    readonly temperatures?: readonly ("cold" | "warm")[]
    readonly onCell?: (cell: ProjectIndexBenchmarkCellResult) => void | Promise<void>
    readonly onProgress?: (progress: ProjectIndexBenchmarkProgress) => void | Promise<void>
  } = {},
): Promise<ProjectIndexBenchmarkReport> {
  const sampleCount = input.samples ?? 1
  if (!Number.isSafeInteger(sampleCount) || sampleCount < 1)
    throw new TypeError("Benchmark sample count must be positive")
  const full = input.full ?? false
  const resourcesMatrix = input.resources ?? (full ? fullResources : smokeResources)
  const retainedFramesMatrix = input.retainedFrames ?? (full ? fullRetainedFrames : smokeRetainedFrames)
  const canvasCountMatrix = input.canvasCounts ?? (full ? fullCanvasCounts : smokeCanvasCounts)
  const operations = input.operations ?? allOperations
  const modes = input.modes ?? (["no-op", "real"] as const)
  const temperatures = input.temperatures ?? (["cold", "warm"] as const)
  const results: ProjectIndexBenchmarkCellResult[] = []
  const supportedOperations = operations.filter(
    (operation): operation is Exclude<BenchmarkOperation, "ordinary-canvas-duplicate"> =>
      operation !== "ordinary-canvas-duplicate",
  )
  const benchmarkStartedAt = performance.now()
  const progress = async (
    boundary: ProjectIndexBenchmarkProgressBoundary,
    phase: "start" | "end",
    startedAt?: number,
  ) =>
    input.onProgress?.(
      Object.freeze({
        boundary,
        phase,
        elapsedMs: performance.now() - benchmarkStartedAt,
        ...(startedAt === undefined ? {} : { durationMs: performance.now() - startedAt }),
      }),
    )
  const fixtureHeads = new Map<number, AcceptedHeadView>()
  const baseResourceCounts = new Set(
    resourcesMatrix.flatMap((resources) =>
      retainedFramesMatrix.map((retainedFrames) => resources - Math.min(resources, retainedFrames)),
    ),
  )
  for (const resources of baseResourceCounts) {
    const startedAt = performance.now()
    await progress("fixture-build", "start")
    fixtureHeads.set(resources, createCardinalityFixtureHead(resources))
    await progress("fixture-build", "end", startedAt)
  }
  for (const mode of modes) {
    for (const operation of supportedOperations)
      for (const resources of resourcesMatrix) {
        for (const retainedFrames of retainedFramesMatrix)
          for (const temperature of temperatures) {
            const diagnostics: CollaborationLatencyDiagnostic[] = []
            const barrierSamples: BarrierSample[] = []
            const roots: Digest[] = []
            let fullUpdateBytes = 0
            let actual = {
              resources: 0,
              operations: 0,
              retainedFrames: 0,
              retainedFramesAfterTimedCommit: 0,
              canvasCount: 1,
            }
            for (let sample = 0; sample < sampleCount; sample += 1) {
              const measured = await runSample({
                mode,
                operation,
                resources,
                retainedFrames,
                temperature,
                sample,
                diagnostics,
                barrierSamples,
                fixtureHead: fixtureHeads.get(resources - Math.min(resources, retainedFrames))!,
                progress,
              })
              fullUpdateBytes = measured.fullUpdateBytes
              actual = measured.actual
              roots.push(measured.semanticRoot)
            }
            const cell = summarize({
              mode,
              operation,
              resources,
              retainedFrames,
              temperature,
              sampleCount,
              fullUpdateBytes,
              roots,
              diagnostics,
              barrierSamples,
              actual,
            })
            results.push(cell)
            await input.onCell?.(cell)
          }
      }
  }
  return Object.freeze({
    metadata: benchmarkMetadata({ resources: input.resources, full }),
    cells: Object.freeze(results),
    unsupported: Object.freeze(
      operations.flatMap((operation) =>
        canvasCountMatrix
          .filter((canvasCount) => operation === "ordinary-canvas-duplicate" || canvasCount !== 1)
          .map((canvasCount) =>
            Object.freeze({
              operation,
              canvasCount,
              code: "public-benchmark-composition-unavailable" as const,
              missingCapability:
                operation === "ordinary-canvas-duplicate"
                  ? "No public benchmark composition opens an independently seeded production Canvas owner/kernel session and invokes the ordinary nodes.duplicate business command."
                  : "No public ProjectIndex benchmark fixture can seed and verify N live Canvas routes without the Canvas-genesis materializer and fact-authority composition.",
            }),
          ),
      ),
    ),
    complexity: complexity(results),
  })
}

async function runSample(input: {
  readonly mode: Mode
  readonly operation: Exclude<BenchmarkOperation, "ordinary-canvas-duplicate">
  readonly resources: ResourceCount
  readonly retainedFrames: RetainedFrameCount
  readonly temperature: "cold" | "warm"
  readonly sample: number
  readonly diagnostics: CollaborationLatencyDiagnostic[]
  readonly barrierSamples: BarrierSample[]
  readonly fixtureHead: AcceptedHeadView
  readonly progress: (
    boundary: ProjectIndexBenchmarkProgressBoundary,
    phase: "start" | "end",
    startedAt?: number,
  ) => void | Promise<void>
}): Promise<{
  readonly semanticRoot: Digest
  readonly fullUpdateBytes: number
  readonly actual: {
    resources: number
    operations: number
    retainedFrames: number
    retainedFramesAfterTimedCommit: number
    canvasCount: number
  }
}> {
  const authority = installCurrentProtocolAuthority()
  const scope = Object.freeze({
    projectId: parseProjectId("benchmark-project"),
    projectEpoch: id(1),
    docKind: "project-index" as const,
    docId: "project-index" as const,
    shardEpoch: id(2),
  })
  const owner = createMainProjectIndexOwnerRuntime(authority)
  const facts = createLocalBlobProjectIndexFactPorts({
    factory: owner.externalFactPortFactory,
    scope,
    blobs: { queryHave: async (requests) => requests.map((request) => Object.freeze({ ...request })) },
  })
  const operationIds = Array.from({ length: input.retainedFrames + 8 }, (_, index) =>
    id(10_000 + input.sample * 10_000 + index),
  )
  const sampleDiagnostics: CollaborationLatencyDiagnostic[] = []
  const diagnostics = createMainCollaborationLatencyDiagnosticsPort({
    sample: () => ({}),
    recordAll: true,
    write: (value) => sampleDiagnostics.push(value),
  })
  const storeSetupStartedAt = performance.now()
  await input.progress("store-setup", "start")
  const root = await fs.mkdtemp(path.join(os.tmpdir(), `convax-project-index-bench-${input.mode}-`))
  const barrierTracker = new BenchmarkBarrierTracker()
  try {
    const initial = cloneAcceptedHead(input.fixtureHead)
    const materializerCounter = createBenchmarkCountingMaterializerRegistry(authority)
    const materializers = materializerCounter.registry
    const persistence =
      input.mode === "real"
        ? await openBenchmarkNodePersistence(root, initial, materializers, barrierTracker)
        : new BenchmarkNoOpPersistence(initial, authority)
    let runtime: MainCollaborationProductionRuntime<"project-index"> | undefined
    const openSession = async () => {
      runtime =
        input.mode === "real"
          ? await createMainCollaborationProductionRuntime({
              authority,
              scope,
              owner,
              actorId,
              localAuthority: localAuthority(authority),
              incomingAuthority: { verify: async () => "rejected" as const },
              incomingFacts: facts.incomingFacts,
              createDocument: createProjectIndexReconstructionYDoc,
              requiredBlobDigests: requiredProjectIndexBlobDigests,
              persistence: persistence as NodeCollaborationPersistence,
              materializers,
            })
          : undefined
      return createKernelBackedMainCollaborationDocumentSession({
        authority,
        scope,
        owner,
        ports: runtime?.ports ?? noOpPorts(persistence as BenchmarkNoOpPersistence, authority, facts),
        signatureVerifier: { verify: async () => true },
        createOperationId: () => operationIds.shift()!,
        diagnostics,
      })
    }
    let session = await openSession()
    await input.progress("store-setup", "end", storeSetupStartedAt)
    try {
      let successfulOperations = 0
      let application = new ProjectIndexFileApplication({
        session,
        facts: facts.facts,
        blobs: { admitManaged: async () => undefined, publish: async () => undefined },
        createOperationId: () => operationIds.shift()!,
      })
      const retainedSetupStartedAt = performance.now()
      await input.progress("retained-setup", "start")
      const createFrameCount = Math.min(input.resources, input.retainedFrames)
      for (let index = 0; index < createFrameCount; index += 1) {
        const setup = await application.publishFile({
          projectId: scope.projectId,
          path: `setup-resource-${index}.md`,
          exactBytes: encoder.encode(`# ProjectIndex setup resource ${index}\n`),
          mime: "text/markdown",
          contentPolicy: "conflict-preserving-text",
          provenance: "user",
        })
        if (setup.status !== "committed") throw new Error("benchmark retained-frame create setup failed")
        successfulOperations += 1
      }
      let currentPath = "setup-resource-0.md"
      for (let index = createFrameCount; index < input.retainedFrames; index += 1) {
        const nextPath = index % 2 === 0 ? "setup-resource-0-moved.md" : "setup-resource-0.md"
        const setup = await application.relocateEntry({
          projectId: scope.projectId,
          currentPath,
          nextPath,
          reason: "rename",
        })
        if (setup.status !== "committed") throw new Error("benchmark retained-frame relocate setup failed")
        currentPath = nextPath
        successfulOperations += 1
      }
      await input.progress("retained-setup", "end", retainedSetupStartedAt)
      const fullUpdateBytes = (await persistence.loadReplicaHead(scope)).fullUpdate.byteLength
      const retainedFramesBeforeTimed =
        input.mode === "real"
          ? (await (persistence as NodeCollaborationPersistence).sampleLatencyDiagnostics(scope)).historyCount
          : (persistence as BenchmarkNoOpPersistence).retainedFrameCount()
      sampleDiagnostics.splice(0)
      barrierTracker.reset()
      if (input.temperature === "cold") {
        session.dispose()
        runtime?.dispose()
        runtime = undefined
        session = await openSession()
        application = new ProjectIndexFileApplication({
          session,
          facts: facts.facts,
          blobs: { admitManaged: async () => undefined, publish: async () => undefined },
          createOperationId: () => operationIds.shift()!,
        })
      } else {
        const warmPreflightStartedAt = performance.now()
        await input.progress("warm-preflight", "start")
        await session.query(() => undefined)
        await new Promise<void>((resolve) => setTimeout(resolve, 0))
        await input.progress("warm-preflight", "end", warmPreflightStartedAt)
      }
      const timedBaseResourceCount = await session.query(
        (state) => (state.value as { entries: Map<unknown, unknown> }).entries.size - 1,
      )
      const timedLabel = `${input.sample}-${input.operation}-${input.temperature}`
      const timedCommitStartedAt = performance.now()
      await input.progress("timed-commit", "start")
      const timed =
        input.operation === "new-text"
          ? await application.publishFile({
              projectId: scope.projectId,
              path: `timed-${timedLabel}.md`,
              exactBytes: encoder.encode(`# ProjectIndex durable benchmark ${timedLabel}\n`),
              mime: "text/markdown",
              contentPolicy: "conflict-preserving-text",
              provenance: "user",
            })
          : await application.admitManagedBlob({
              projectId: scope.projectId,
              admission: {
                blob: Object.freeze({
                  format: "convax.blob-ref" as const,
                  algorithm: "sha256" as const,
                  digest: ordinarySha256(encoder.encode(`project-index-benchmark-image-${timedLabel}`)),
                  byteLength: parseUint64(
                    String(encoder.encode(`project-index-benchmark-image-${timedLabel}`).byteLength),
                  ),
                  mime: "image/png",
                }),
                async readChunks(consume) {
                  await consume(encoder.encode(`project-index-benchmark-image-${timedLabel}`))
                },
              },
            })
      await input.progress("timed-commit", "end", timedCommitStartedAt)
      if (timed.status !== "committed") throw new Error("benchmark timed ProjectIndex command failed")
      successfulOperations += 1
      const after = await persistence.loadReplicaHead(scope)
      if (timedBaseResourceCount !== input.resources)
        throw new Error("resource dimension did not enter timed candidate base")
      if (sampleDiagnostics.length !== 1) throw new Error("benchmark diagnostic sample was filtered or duplicated")
      input.diagnostics.push(sampleDiagnostics[0]!)
      if (input.mode === "real" && barrierTracker.snapshot().length === 0)
        throw new Error(
          `Node persistence requested ${barrierTracker.requestedAttempts()} durability attempts but emitted no physical sync measurements`,
        )
      input.barrierSamples.push(...barrierTracker.snapshot())
      const retainedFramesAfterTimedCommit =
        input.mode === "real"
          ? (await (persistence as NodeCollaborationPersistence).sampleLatencyDiagnostics(scope)).historyCount
          : (persistence as BenchmarkNoOpPersistence).retainedFrameCount()
      return {
        semanticRoot: after.canonicalStateDigest,
        fullUpdateBytes,
        actual: {
          resources: timedBaseResourceCount,
          operations: successfulOperations,
          retainedFrames: retainedFramesBeforeTimed,
          retainedFramesAfterTimedCommit,
          canvasCount: 1,
        },
      }
    } finally {
      session.dispose()
      runtime?.dispose()
      persistence.dispose?.()
    }
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
}

function createCardinalityFixtureHead(resources: number): AcceptedHeadView {
  const authority = installCurrentProtocolAuthority()
  const scope = Object.freeze({
    projectId: parseProjectId("benchmark-project"),
    projectEpoch: id(1),
    docKind: "project-index" as const,
    docId: "project-index" as const,
    shardEpoch: id(2),
  })
  const owner = createMainProjectIndexOwnerRuntime(authority)
  const candidate = createEmptyProjectIndexGenesisCandidate({
    scope,
    actorId,
    operationId: id(0),
    checkpointId: id(3),
    authorMemberId: parseMemberId(encodeBase64url(new Uint8Array(16).fill(8))),
    authorReplicaId: replicaId,
    authorAuthorizationDigest: ordinarySha256(encoder.encode("benchmark-owner")),
    validationArtifactSetDigest: ordinarySha256(encoder.encode("benchmark-artifacts")),
    authority: {
      protocolDigest: authority.protocolDigest,
      schemaDigest: PROJECT_INDEX_PROTOCOL_SCHEMA_ARTIFACT_DIGEST,
      uriProtocolDigest: authority.protocolSchemaBundle.core.uriProtocolDigest,
    },
  })
  try {
    const seeded = populateProjectIndexBenchmarkFixture(candidate.document, resources)
    if (seeded.ownerResourceCount !== resources) throw new Error("benchmark resource fixture cardinality mismatches")
    return initialHead(owner, authority, scope, candidate.document)
  } finally {
    candidate.document.destroy()
  }
}

function cloneAcceptedHead(head: AcceptedHeadView): AcceptedHeadView {
  return Object.freeze({
    ...head,
    fullUpdate: Uint8Array.from(head.fullUpdate),
    stateVector: Uint8Array.from(head.stateVector) as AcceptedHeadView["stateVector"],
  })
}

export function createBenchmarkCountingMaterializerRegistry(authority: CurrentProtocolAuthority): {
  readonly registry: ProjectCollaborationMaterializerRegistry
  readonly applyCount: () => number
} {
  const base = createProjectCollaborationMaterializerRegistry(authority)
  let count = 0
  const registry: ProjectCollaborationMaterializerRegistry = Object.freeze({
    register: (input) => base.register(input),
    inspectFrame: (ref, exactBytes) => base.inspectFrame(ref, exactBytes),
    applyAcceptedFrame: (input) => {
      count += 1
      return base.applyAcceptedFrame(input)
    },
    observeAcceptedFrame: (ref, exactBytes, durableDelta) =>
      base.observeAcceptedFrame?.(ref, exactBytes, durableDelta),
    actorHeadsDigest: (actorHeads) => base.actorHeadsDigest(actorHeads),
  })
  return Object.freeze({ registry, applyCount: () => count })
}

type BarrierSample = Readonly<{
  kind: NodeLocalCommitDurabilityMeasurement["barrierKind"]
  stage: NodeLocalCommitDurabilityMeasurement["stage"]
  durationMs: number
  callCount: number
}>

export class BenchmarkBarrierTracker {
  private samples: BarrierSample[] = []
  private attemptRequests = 0
  private captureLocal = false
  readonly diagnostics: NodeLocalCommitDurabilityDiagnostics = Object.freeze({
    currentAttemptId: () => {
      this.attemptRequests += 1
      return "benchmark-timed-root"
    },
    observe: (measurement) =>
      this.samples.push(
        Object.freeze({
          kind: measurement.barrierKind,
          stage: measurement.stage,
          durationMs: Number(measurement.durationNanoseconds) / 1_000_000,
          callCount: measurement.callCount,
        }),
      ),
    ...(process.env.CONVAX_BENCH_LOCAL_STEPS === "1"
      ? {
          observeLocalStep: (
            measurement: Parameters<NonNullable<NodeLocalCommitDurabilityDiagnostics["observeLocalStep"]>>[0],
          ) => {
            if (!this.captureLocal) return
            process.stderr.write(
              `${JSON.stringify({
                type: "local-step",
                stage: measurement.stage,
                step: measurement.step,
                durationMs: Number(measurement.durationNanoseconds) / 1_000_000,
              })}\n`,
            )
          },
        }
      : {}),
  })
  reset() {
    this.samples = []
    this.attemptRequests = 0
    this.captureLocal = true
  }
  snapshot() {
    return [...this.samples]
  }
  requestedAttempts() {
    return this.attemptRequests
  }
}

export async function openBenchmarkNodePersistence(
  root: string,
  initial: AcceptedHeadView,
  materializers: ReturnType<typeof createProjectCollaborationMaterializerRegistry>,
  tracker: BenchmarkBarrierTracker,
  localActorId: typeof actorId = actorId,
) {
  const directory = path.join(root, "collaboration")
  await fs.mkdir(directory, { recursive: true })
  const store = await NodeCollaborationPersistence.open({
    collaborationDirectory: directory,
    localActorId,
    materializer: materializers,
    durabilityDiagnostics: tracker.diagnostics,
  })
  const release = materializers.register({
    scope: initial.scope,
    materializer: Object.freeze({
      inspectFrame: async () => {
        throw new Error("benchmark genesis has no frame")
      },
      applyAcceptedFrame: async () => {
        throw new Error("benchmark genesis has no frame")
      },
      actorHeadsDigest: replicaActorHeadSetDigest,
    }),
  })
  try {
    await store.initializeShard({
      scope: initial.scope,
      checkpointObjectDigest: ordinarySha256(encoder.encode("benchmark-checkpoint")),
      checkpointExactBytes: encoder.encode("benchmark-checkpoint"),
      acceptedBase: initial,
    })
  } finally {
    release()
  }
  return store
}

function initialHead(
  owner: ReturnType<typeof createMainProjectIndexOwnerRuntime>,
  authority: CurrentProtocolAuthority,
  scope: Parameters<typeof createEmptyProjectIndexGenesisCandidate>[0]["scope"],
  document: ReturnType<typeof createEmptyProjectIndexGenesisCandidate>["document"],
): AcceptedHeadView {
  const frontier = Object.freeze({ format: "convax.causal-frontier" as const, heads: Object.freeze([]) })
  const validated = owner.protocolPort.validateBase(document)
  if (validated === "rejected") throw new Error("benchmark fixture rejected by production owner")
  const headDigest = ordinarySha256(encoder.encode("benchmark-head:genesis"))
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
    canonicalStateDigest: projectIndexCanonicalStateCommitmentDigest(document, authority),
    materializationDigest: headDigest,
  })
  return Object.freeze({ ...base, materializationDigest: acceptedHeadMaterializedStateDigest(base) })
}

function noOpPorts(
  persistence: BenchmarkNoOpPersistence,
  authority: CurrentProtocolAuthority,
  facts: ReturnType<typeof createLocalBlobProjectIndexFactPorts>,
): CollaborationKernelPorts {
  return Object.freeze({
    createDocument: createProjectIndexReconstructionYDoc,
    persistence,
    localAuthority: {
      actorId,
      prepareFinalFrameAuthority: async (
        request: Parameters<CollaborationKernelPorts["localAuthority"]["prepareFinalFrameAuthority"]>[0],
      ) => frameAuthority(authority, request.previousActorHead),
    },
    incomingAuthority: { verifyFrameAuthority: async () => "rejected" as const },
    incomingFacts: facts.incomingFacts,
    exactBaseResolver: { reconstructExactBase: async () => "pending" as const },
    causalClosure: { contains: () => false },
    pendingInbox: { retainExactFrame: async () => "retained" as const },
  })
}

function localAuthority(authority: CurrentProtocolAuthority): CurrentLocalReplicaAuthoritySource {
  return Object.freeze({
    resolveCurrent: async (request) => {
      const prepared = frameAuthority(authority, null)
      return Object.freeze({
        scope: request.scope,
        operationId: request.operationId,
        baseFrontierDigest: request.baseFrontierDigest,
        ownerSchemaDigest: request.ownerSchemaDigest,
        signerAuthority: prepared.signerAuthority,
        dependencies: prepared.dependencies,
        validationArtifacts: prepared.validationArtifacts,
        signer: prepared.signer,
      })
    },
  })
}

function frameAuthority(
  authority: CurrentProtocolAuthority,
  previous: Parameters<
    CollaborationKernelPorts["localAuthority"]["prepareFinalFrameAuthority"]
  >[0]["previousActorHead"],
): LocalFrameAuthority {
  const bindingDigest = ordinarySha256(encoder.encode("benchmark-local-owner"))
  return Object.freeze({
    actorId,
    actorSequence: parseUint64(previous ? String(BigInt(previous.actorSequence) + 1n) : "1"),
    predecessorFrameDigest: previous?.frameDigest ?? null,
    signerAuthority: Object.freeze({
      kind: "local-project-owner" as const,
      replicaId,
      actorId,
      ownerBindingDigest: bindingDigest,
      ownerEditAuthorizationCoreDigest: ordinarySha256(encoder.encode("benchmark-edit-authorization")),
    }),
    dependencies: Object.freeze([
      { kind: "local-owner-binding" as const, digest: bindingDigest },
      {
        kind: "local-owner-edit-authorization" as const,
        digest: ordinarySha256(encoder.encode("benchmark-edit-authorization")),
      },
    ]),
    validationArtifacts: artifactMaterials(authority),
    signer: Object.freeze({ sign: async () => signature }),
  })
}

function artifactMaterials(authority: CurrentProtocolAuthority): ValidationArtifactSet {
  const owners = new Map([
    ["canvas-schema", "canvas"],
    ["collaboration-kernel", "kernel"],
    ["control-plane", "control-plane"],
    ["project-persistence", "project-index"],
  ] as const)
  const artifacts = authority.protocolSchemaBundle.core.artifacts
    .map((selected) => {
      const owner = owners.get(selected.name)
      if (!owner) throw new Error("unknown protocol artifact")
      const artifact = Object.freeze({ owner, format: selected.format, artifactDigest: selected.artifactDigest })
      return artifact
    })
    .sort((a, b) => a.owner.localeCompare(b.owner))
  return Object.freeze({ format: "convax.validation-artifact-set", artifacts: Object.freeze(artifacts) })
}

export class BenchmarkNoOpPersistence implements CollaborationPersistencePort {
  private head: AcceptedHeadView
  private frame?: { ref: FrameObjectRef; bytes: Uint8Array }
  private acceptedFrames = 0
  constructor(
    initial: AcceptedHeadView,
    private readonly authority: CurrentProtocolAuthority,
    private readonly createDocument: () => import("yjs").Doc = createProjectIndexReconstructionYDoc,
  ) {
    this.head = initial
  }
  loadReplicaHead = async () => this.head
  commitAcceptedFrame = async (request: Parameters<CollaborationPersistencePort["commitAcceptedFrame"]>[0]) => {
    const validated = validateAcceptedHeadMaterializationEvidence({
      previous: this.head,
      ref: request.ref,
      evidence: request.accepted,
    })
    if (validated === "rejected") throw new Error("benchmark materialization evidence rejected")
    const frame = decodeCausalEditFrame(this.authority, new Uint8Array(request.exactFrameBytes))
    const document = this.createDocument()
    applyYjsUpdate(document, this.head.fullUpdate, this)
    applyYjsUpdate(document, frame.sections.yjsUpdate, this)
    const resulting = ordinarySha256(encoder.encode(`head:${request.ref.frameDigest}`))
    try {
      this.head = Object.freeze({
        ...validated.transition,
        headDigest: resulting,
        fullUpdate: encodeFullUpdate(document),
      })
    } finally {
      document.destroy()
    }
    this.frame = { ref: request.ref, bytes: Uint8Array.from(request.exactFrameBytes) }
    this.acceptedFrames += 1
    const recordDigest = (kind: string) => ordinarySha256(encoder.encode(`${kind}:${request.ref.frameDigest}`))
    return Object.freeze({
      status: "committed" as const,
      evidence: Object.freeze({
        format: "convax.accepted-frame-atomic-commit-evidence" as const,
        ref: request.ref,
        frameRecordDigest: recordDigest("frame"),
        outboxRecordDigest: recordDigest("outbox"),
        journalRecordDigest: recordDigest("journal"),
        expectedReplicaHeadRecordDigest: request.expectedHead.headDigest,
        resultingReplicaHeadRecordDigest: resulting,
        resultingFrontierDigest: validated.transition.frontierDigest,
        resultingMaterializationDigest: validated.transition.materializationDigest,
        atomicCommitRecordDigest: recordDigest("atomic"),
      }),
    })
  }
  isReachableFromAcceptedHead = async (ref: FrameObjectRef) => this.frame?.ref.frameDigest === ref.frameDigest
  lookupOperation = async (): Promise<OperationLookup> => ({ status: "absent" })
  scanDurableReferences = async () => ({ complete: true, reachable: false })
  quarantineExactObject = async () => undefined
  dispose() {}
  retainedFrameCount() {
    return this.acceptedFrames
  }
}

function summarize(input: {
  mode: Mode
  operation: Exclude<BenchmarkOperation, "ordinary-canvas-duplicate">
  resources: ResourceCount
  retainedFrames: RetainedFrameCount
  temperature: "cold" | "warm"
  sampleCount: number
  fullUpdateBytes: number
  roots: Digest[]
  diagnostics: CollaborationLatencyDiagnostic[]
  barrierSamples: BarrierSample[]
  actual: {
    resources: number
    operations: number
    retainedFrames: number
    retainedFramesAfterTimedCommit: number
    canvasCount: number
  }
}): ProjectIndexBenchmarkCellResult {
  if (input.diagnostics.length !== input.sampleCount)
    throw new Error("benchmark diagnostic sample was filtered or lost")
  const processedSetSizes = Object.freeze({
    resources: input.actual.resources,
    retainedFrames: input.actual.retainedFrames,
    canvasCount: input.actual.canvasCount,
    bytes: input.fullUpdateBytes,
  })
  const groupedStages: Readonly<
    Record<DurableBusinessStage, readonly (keyof CollaborationLatencyDiagnostic["stages"])[]>
  > = {
    queue: ["queue"],
    "operation-lookup": ["operation-lookup"],
    "head-check": ["head-check"],
    "prepare/facts": ["authority-prepare", "owner-prepare"],
    "candidate-clone": ["candidate-clone"],
    reducer: ["reducer"],
    validate: ["base-validation", "canonical-delta-validation", "frame-decode"],
    canonicalize: ["canonical-state-digest"],
    "state-encode": ["base-state-encode", "delta-encode", "frame-encode"],
    sign: ["sign"],
    "atomic-accepted-frame-commit": ["atomic-accepted-frame-commit"],
    "replica-apply": ["replica-apply"],
    projection: ["projection"],
  }
  const stages = Object.freeze(
    Object.fromEntries(
      durableBusinessStages.map((name) => {
        const members = groupedStages[name]
        return [
          name,
          Object.freeze({
            durationMs: stats(
              input.diagnostics.map((value) =>
                members.reduce((sum, member) => sum + value.stages[member].durationMs, 0),
              ),
            ),
            callCount: input.diagnostics.reduce(
              (count, value) => count + members.reduce((sum, member) => sum + value.stages[member].callCount, 0),
              0,
            ),
            processedSetSizes,
          }),
        ]
      }),
    ),
  ) as ProjectIndexBenchmarkCellResult["stages"]
  const durabilityBarriers = durabilityStages.map((name) => {
    const all = input.barrierSamples.filter((s) => s.stage === name)
    const durations = all.map((b) => b.durationMs)
    return [name, Object.freeze({ durationMs: stats(durations), callCount: input.sampleCount })] as const
  })
  const totalDurations = input.diagnostics.map((d) => d.totalDurationMs)
  return Object.freeze({
    mode: input.mode,
    operation: input.operation,
    resources: input.resources,
    retainedFrames: input.retainedFrames,
    canvasCount: 1,
    temperature: input.temperature,
    sampleCount: input.sampleCount,
    fullUpdateBytes: input.fullUpdateBytes,
    successfulSemanticRoots: [...new Set(input.roots)].length,
    semanticRoots: Object.freeze([...input.roots]),
    roots: Object.freeze({ projectIndex: Object.freeze([...input.roots]), canvases: Object.freeze([]) }),
    actual: Object.freeze({ ...input.actual }),
    totalMs: stats(totalDurations),
    stages,
    kernelDurabilityStages: Object.freeze(Object.fromEntries(durabilityBarriers)),
    durability: Object.freeze({
      physicalSyncCount: input.barrierSamples.reduce((sum, s) => sum + s.callCount, 0),
      barriers: Object.freeze(
        input.barrierSamples.map((s) => {
          const all = input.barrierSamples.filter((b) => b.stage === s.stage && b.kind === s.kind)
          const durations = all.map((b) => b.durationMs)
          return Object.freeze({
            kind: s.kind,
            stage: s.stage,
            durationMs: stats(durations),
            callCount: all.reduce((sum, b) => sum + b.callCount, 0),
          })
        }),
      ),
    }),
  })
}

function stats(durations: number[]): Distribution {
  const sorted = [...durations].sort((a, b) => a - b)
  if (sorted.length === 0) return Object.freeze({ p50: 0, p95: 0, p99: 0 })
  return Object.freeze({
    p50: sorted[Math.floor(sorted.length * 0.5)]!,
    p95: sorted[Math.floor(sorted.length * 0.95)]!,
    p99: sorted[Math.floor(sorted.length * 0.99)]!,
  })
}

function complexity(cells: ProjectIndexBenchmarkCellResult[]): ProjectIndexBenchmarkReport["complexity"] {
  const realWarms = cells.filter((c) => c.mode === "real" && c.temperature === "warm")
  const resources = resourceScale(realWarms, 32, 512)
  const retainedFrames = retainedScale(realWarms.filter((c) => c.resources === 1), 1, 512)
  const canvasCount = canvasCountScale(cells, 1, 32)
  return Object.freeze({ ...resources, ...retainedFrames, ...canvasCount })
}

function resourceScale(
  cells: ProjectIndexBenchmarkCellResult[],
  low: number,
  high: number,
): Pick<ProjectIndexBenchmarkReport["complexity"], "resources-32-to-512"> {
  const lowCells = cells.filter((c) => c.resources === low && c.retainedFrames === 1)
  const highCells = cells.filter((c) => c.resources === high && c.retainedFrames === 1)
  if (lowCells.length === 0 || highCells.length === 0) {
    return {
      "resources-32-to-512": Object.freeze({
        status: "unsupported",
        ratios: Object.freeze({}),
        slopes: Object.freeze({}),
        reason: "No real-warm cell found with 32 or 512 resources at 1 retained frame",
      }),
    }
  }
  const lowMedian = lowCells.reduce((sum, c) => sum + c.totalMs.p50, 0) / lowCells.length
  const highMedian = highCells.reduce((sum, c) => sum + c.totalMs.p50, 0) / highCells.length
  return {
    "resources-32-to-512": Object.freeze({
      status: "available",
      ratios: Object.freeze({ "p50-totalMs": highMedian / lowMedian }),
      slopes: Object.freeze({ "p50-totalMs-per-100%": (highMedian - lowMedian) / (high - low) }),
    }),
  }
}

function retainedScale(
  cells: ProjectIndexBenchmarkCellResult[],
  low: number,
  high: number,
): Pick<ProjectIndexBenchmarkReport["complexity"], "retained-frames-32-to-512"> {
  const lowCells = cells.filter((c) => c.retainedFrames === low && c.resources === 1)
  const highCells = cells.filter((c) => c.retainedFrames === high && c.resources === 1)
  if (lowCells.length === 0 || highCells.length === 0) {
    return {
      "retained-frames-32-to-512": Object.freeze({
        status: "unsupported",
        ratios: Object.freeze({}),
        slopes: Object.freeze({}),
        reason: "No real-warm cell found with 32 or 512 retained frames at 1 resource",
      }),
    }
  }
  const lowMedian = lowCells.reduce((sum, c) => sum + c.totalMs.p50, 0) / lowCells.length
  const highMedian = highCells.reduce((sum, c) => sum + c.totalMs.p50, 0) / highCells.length
  return {
    "retained-frames-32-to-512": Object.freeze({
      status: "available",
      ratios: Object.freeze({ "p50-totalMs": highMedian / lowMedian }),
      slopes: Object.freeze({ "p50-totalMs-per-100%": (highMedian - lowMedian) / (high - low) }),
    }),
  }
}

function canvasCountScale(
  cells: ProjectIndexBenchmarkCellResult[],
  low: number,
  high: number,
): Pick<ProjectIndexBenchmarkReport["complexity"], "canvas-count-1-to-32"> {
  const lowCells = cells.filter((c) => c.canvasCount === low)
  const highCells = cells.filter((c) => c.canvasCount === high)
  if (lowCells.length === 0 || highCells.length === 0) {
    return {
      "canvas-count-1-to-32": Object.freeze({
        status: "unsupported",
        ratios: Object.freeze({}),
        slopes: Object.freeze({}),
        reason: "No cell found with 1 or 32 canvas counts",
      }),
    }
  }
  return {
    "canvas-count-1-to-32": Object.freeze({
      status: "unsupported",
      ratios: Object.freeze({}),
      slopes: Object.freeze({}),
      reason: "Canvas count not available in ProjectIndex-only benchmark",
    }),
  }
}

function id(seed: number): ReturnType<typeof parseId128> {
  const bytes = new Uint8Array(16)
  new DataView(bytes.buffer).setUint32(12, seed)
  return parseId128(encodeBase64url(bytes))
}

export function parseBenchmarkModeOverride(raw: unknown): Mode[] {
  if (typeof raw !== "string") throw new TypeError("CONVAX_BENCH_MODE must be a string")
  const parts = raw.split(",").map((value) => value.trim())
  if (parts.some((value) => value !== "no-op" && value !== "real")) {
    throw new TypeError("CONVAX_BENCH_MODE must be a unique subset of no-op,real")
  }
  const unique = [...new Set(parts)]
  if (unique.length !== parts.length) throw new TypeError("CONVAX_BENCH_MODE must contain a unique subset")
  return unique as Mode[]
}

export function parseBenchmarkTemperatureOverride(raw: unknown): ("cold" | "warm")[] {
  if (typeof raw !== "string") throw new TypeError("CONVAX_BENCH_TEMPERATURE must be a string")
  const parts = raw.split(",").map((value) => value.trim())
  if (parts.some((value) => value !== "cold" && value !== "warm")) {
    throw new TypeError("CONVAX_BENCH_TEMPERATURE must be a unique subset of cold,warm")
  }
  const unique = [...new Set(parts)]
  if (unique.length !== parts.length) throw new TypeError("CONVAX_BENCH_TEMPERATURE must contain a unique subset")
  return unique as ("cold" | "warm")[]
}
