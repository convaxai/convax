import {
  adaptCanvasApplicationCommand,
  canvasSnapshotFromValidatedOwnerState,
  constructCanvasAuthoritativeIntent,
  createCanvasReconstructionYDoc,
  projectCanvas,
  type CanvasAuthoritativeCommand,
  type CanvasSnapshot,
} from "@convax/canvas/collaboration"
import type { CanvasApplicationCommand, CanvasApplicationCommandRequest } from "@convax/canvas/application"
import {
  encodeRestrictedJcs,
  parseId128,
  type CollaborationLatencyDiagnostic,
  type CurrentProtocolAuthority,
  type OwnerExternalFactPort,
  type OwnerIntentDependencies,
} from "@convax/collaboration"

import { createCurrentLocalReplicaAuthorityPort } from "../src/main/collaboration-authority-ports"
import {
  createKernelBackedMainCollaborationDocumentSession,
  createMainCollaborationLatencyDiagnosticsPort,
  type MainCollaborationDocumentSession,
} from "../src/main/collaboration-document-session"
import { BenchmarkNoOpPersistence, durableBusinessStages } from "./project-index-durable-benchmark"
import { createVerifiedCanvasBenchmarkComposition } from "./canvas-duplicate-benchmark-composition"

export type CanvasDuplicateBenchmarkMode = "no-op" | "real"
export type CanvasDuplicateBenchmarkTemperature = "cold" | "warm"
export type CanvasDuplicateBenchmarkNodeCount = 1 | 32 | 128 | 512
export type CanvasDuplicateBenchmarkRetainedFrames = 1 | 32 | 128 | 512

export const canvasDuplicateFastPathAcceptance = Object.freeze({
  fastDuplicateFullValidationCalls: 0,
  fallbackMinimumFullValidationCalls: 1,
  selectedCell: Object.freeze({
    mode: "real" as const,
    temperature: "warm" as const,
    nodeCount: 512 as const,
    retainedFrames: 32 as const,
    samples: 20,
  }),
})

export function assertCanvasDuplicateFastPathAcceptance(input: {
  readonly fastDuplicateFullValidationCalls: number
  readonly fallbackOtherIntentFullValidationCalls: number
  readonly fallbackTransactionTamperFullValidationCalls: number
}): void {
  if (input.fastDuplicateFullValidationCalls !== canvasDuplicateFastPathAcceptance.fastDuplicateFullValidationCalls) {
    throw new Error("Canvas duplicate fast path performed a full owner validation")
  }
  if (
    input.fallbackOtherIntentFullValidationCalls <
      canvasDuplicateFastPathAcceptance.fallbackMinimumFullValidationCalls ||
    input.fallbackTransactionTamperFullValidationCalls <
      canvasDuplicateFastPathAcceptance.fallbackMinimumFullValidationCalls
  ) {
    throw new Error("Canvas owner fallback stopped performing full validation")
  }
}

export interface CanvasDuplicateBenchmarkResult {
  readonly mode: CanvasDuplicateBenchmarkMode
  readonly temperature: CanvasDuplicateBenchmarkTemperature
  readonly diagnostic: CollaborationLatencyDiagnostic
  readonly stages: Readonly<
    Record<
      (typeof durableBusinessStages)[number],
      Readonly<{
        durationMs: number
        callCount: number
        processedSetSizes: Readonly<{ nodes: number; retainedFrames: number; canvasCount: 1 | 8 | 32; bytes: number }>
      }>
    >
  >
  readonly actual: Readonly<{
    nodesBefore: number
    nodesAfter: number
    retainedFrames: number
    materializerDelta: number
    physicalSyncCount: number
    requestedCanvasCount: 1 | 8 | 32
    openedCanvasShards: 1 | 8 | 32
    ownerFullValidateCalls: number
    ownerCanonicalStateCalls: number
  }>
}

export interface CanvasDuplicateBenchmarkSummary {
  readonly samples: number
  readonly totalMs: Readonly<{ p50: number; p95: number; p99: number }>
  readonly stages: Readonly<
    Record<
      (typeof durableBusinessStages)[number],
      Readonly<{
        durationMs: Readonly<{ p50: number; p95: number; p99: number }>
        callCount: number
        processedSetSizes: CanvasDuplicateBenchmarkResult["stages"]["queue"]["processedSetSizes"]
      }>
    >
  >
  readonly actual: CanvasDuplicateBenchmarkResult["actual"]
}

export async function runCanvasDuplicateBenchmarkSamples(
  input: Parameters<typeof runCanvasDuplicateBenchmarkCell>[0] & {
    readonly samples: number
  },
): Promise<CanvasDuplicateBenchmarkSummary> {
  if (!Number.isSafeInteger(input.samples) || input.samples < 1)
    throw new TypeError("Canvas benchmark samples must be positive")
  const cells: CanvasDuplicateBenchmarkResult[] = []
  for (let sample = 0; sample < input.samples; sample += 1) cells.push(await runCanvasDuplicateBenchmarkCell(input))
  const first = cells[0]!
  for (const cell of cells) {
    if (JSON.stringify(cell.actual) !== JSON.stringify(first.actual))
      throw new Error("Canvas benchmark actual dimensions drifted")
    for (const stage of durableBusinessStages) {
      if (cell.stages[stage].callCount !== first.stages[stage].callCount) {
        throw new Error(`Canvas benchmark ${stage} call count drifted`)
      }
    }
  }
  return Object.freeze({
    samples: input.samples,
    totalMs: stats(cells.map(({ diagnostic }) => diagnostic.totalDurationMs)),
    stages: Object.freeze(
      Object.fromEntries(
        durableBusinessStages.map((stage) => [
          stage,
          Object.freeze({
            durationMs: stats(cells.map((cell) => cell.stages[stage].durationMs)),
            callCount: first.stages[stage].callCount,
            processedSetSizes: first.stages[stage].processedSetSizes,
          }),
        ]),
      ),
    ) as CanvasDuplicateBenchmarkSummary["stages"],
    actual: first.actual,
  })
}

function stats(values: readonly number[]) {
  const sorted = [...values].sort((left, right) => left - right)
  const percentile = (fraction: number) => sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)]!
  return Object.freeze({ p50: percentile(0.5), p95: percentile(0.95), p99: percentile(0.99) })
}

/** Minimal one-node/one-retained-frame ordinary nodes.duplicate benchmark. */
export async function runCanvasDuplicateBenchmarkCell(input: {
  readonly mode: CanvasDuplicateBenchmarkMode
  readonly temperature: CanvasDuplicateBenchmarkTemperature
  readonly nodeCount?: CanvasDuplicateBenchmarkNodeCount
  readonly retainedFrames?: CanvasDuplicateBenchmarkRetainedFrames
  readonly canvasCount?: 1 | 8 | 32
  readonly onSetupProgress?: (
    progress: Readonly<{
      completedFrames: number
      retainedFrames: CanvasDuplicateBenchmarkRetainedFrames
      elapsedMs: number
    }>,
  ) => void
  readonly timedOperation?: "duplicate" | "set-title"
}): Promise<CanvasDuplicateBenchmarkResult> {
  let captureOwnerCalls = false
  let ownerFullValidateCalls = 0
  let ownerCanonicalStateCalls = 0
  const canvasCount = input.canvasCount ?? 1
  const composition = await createVerifiedCanvasBenchmarkComposition({
    canvasCount,
    onOwnerFullValidate: () => {
      if (captureOwnerCalls) ownerFullValidateCalls += 1
    },
    onOwnerCanonicalState: () => {
      if (captureOwnerCalls) ownerCanonicalStateCalls += 1
    },
  })
  const openedCanvasShards = composition.scopes.length
  if (openedCanvasShards !== 1 && openedCanvasShards !== 8 && openedCanvasShards !== 32) {
    throw new Error("Canvas benchmark opened an unsupported shard cardinality")
  }
  const diagnostics: CollaborationLatencyDiagnostic[] = []
  let nextId = 100
  const createId = () => canvasBenchmarkId(nextId++)
  const noOpPersistences = composition.acceptedBases.map(
    (base) => new BenchmarkNoOpPersistence(base, composition.authority, createCanvasReconstructionYDoc),
  )
  const openSession = async (index: number) => {
    const persistence =
      input.mode === "real"
        ? composition.persistence
        : noOpPersistences[index]!
    return createKernelBackedMainCollaborationDocumentSession({
      authority: composition.authority,
      scope: composition.scopes[index]!,
      owner: composition.canvasOwner,
      ports:
        input.mode === "real"
          ? composition.canvasRuntimes[index]!.ports
          : {
              createDocument: createCanvasReconstructionYDoc,
              persistence,
              localAuthority: createCurrentLocalReplicaAuthorityPort({
                actorId: composition.actorId,
                source: composition.localAuthority,
              }),
              incomingAuthority: { verifyFrameAuthority: async () => "rejected" as const },
              incomingFacts: { resolve: async () => Object.freeze({ status: "rejected" as const }) },
            },
      signatureVerifier: { verify: async () => true },
      createOperationId: createId,
      diagnostics: createMainCollaborationLatencyDiagnosticsPort({
        recordAll: true,
        sample: () => ({}),
        write: (value) => diagnostics.push(value),
      }),
    })
  }
  let sessions = await Promise.all(composition.scopes.map((_, index) => openSession(index)))
  let session = sessions[0]!
  try {
    const nodeCount = input.nodeCount ?? 1
    const retainedFrames = input.retainedFrames ?? 1
    const createFrameCount = Math.ceil(nodeCount / 85)
    if (retainedFrames < createFrameCount) {
      throw new RangeError(
        `Canvas benchmark retained frames ${retainedFrames} cannot legally create ${nodeCount} nodes in ${createFrameCount} bounded intents`,
      )
    }
    const setupStartedAt = performance.now()
    await submitSetupNodes(session, composition.authority, composition.canvasOwner.externalFactPortFactory, nodeCount)
    let setupSnapshot = await session.query((state) => canvasSnapshotFromValidatedOwnerState(state))
    const setupSource = projectCanvas(setupSnapshot).nodes[0]
    if (!setupSource) throw new Error("Canvas duplicate benchmark setup source node is missing")
    for (let index = createFrameCount; index < retainedFrames; index += 1) {
      await submitCommand(session, composition.authority, composition.canvasOwner.externalFactPortFactory, {
        type: "nodes.setTitle",
        nodeId: setupSource.ref.id,
        title: index % 2 === 0 ? "Benchmark source even" : "Benchmark source odd",
      })
      if ((index + 1) % 32 === 0 || index + 1 === retainedFrames) {
        input.onSetupProgress?.(
          Object.freeze({
            completedFrames: index + 1,
            retainedFrames,
            elapsedMs: performance.now() - setupStartedAt,
          }),
        )
      }
    }
    setupSnapshot = await session.query((state) => canvasSnapshotFromValidatedOwnerState(state))
    if (setupSnapshot.nodes.size !== nodeCount) throw new Error("Canvas benchmark setup node cardinality drifted")
    diagnostics.splice(0)
    if (input.temperature === "cold") {
      for (const opened of sessions) opened.dispose()
      sessions = await Promise.all(composition.scopes.map((_, index) => openSession(index)))
      session = sessions[0]!
    } else {
      await Promise.all(sessions.map((opened) => opened.query(() => undefined)))
      // Match the queue-free ProjectIndex definition: permit the one bounded
      // Kernel standby build to settle outside the timed command.
      await new Promise<void>((resolve) => setTimeout(resolve, 0))
    }
    const idleBefore = await Promise.all(
      composition.scopes.slice(1).map((scope, index) => captureShardState(
        input.mode,
        composition.persistence,
        noOpPersistences[index + 1]!,
        scope,
      )),
    )
    const before = await session.query((state) => canvasSnapshotFromValidatedOwnerState(state))
    const timedHead = await (input.mode === "real" ? composition.persistence : noOpPersistences[0]!).loadReplicaHead(
      composition.scope,
    )
    const source = projectCanvas(before).nodes[0]
    if (!source) throw new Error("Canvas duplicate benchmark source node is missing")
    const materializationsBefore = composition.materializerApplyCount()
    composition.barrierTracker.reset()
    captureOwnerCalls = true
    try {
      await submitCommand(
        session,
        composition.authority,
        composition.canvasOwner.externalFactPortFactory,
        input.timedOperation === "set-title"
          ? { type: "nodes.setTitle", nodeId: source.ref.id, title: "Timed fallback title" }
          : {
              type: "nodes.duplicate",
              nodeIds: [source.ref.id],
              offset: { x: 32, y: 32 },
              edgeScope: "connected",
            },
      )
    } finally {
      captureOwnerCalls = false
    }
    const after = await session.query((state) => canvasSnapshotFromValidatedOwnerState(state))
    if (diagnostics.length !== 1) throw new Error("Canvas duplicate benchmark diagnostic was lost or duplicated")
    const idleAfter = await Promise.all(
      composition.scopes.slice(1).map((scope, index) => captureShardState(
        input.mode,
        composition.persistence,
        noOpPersistences[index + 1]!,
        scope,
      )),
    )
    if (JSON.stringify(idleAfter) !== JSON.stringify(idleBefore)) {
      throw new Error("Canvas duplicate benchmark mutated an idle shard")
    }
    return Object.freeze({
      mode: input.mode,
      temperature: input.temperature,
      diagnostic: diagnostics[0]!,
      stages: groupStages(diagnostics[0]!, {
        nodes: before.nodes.size,
        retainedFrames,
        canvasCount: openedCanvasShards,
        bytes: timedHead.fullUpdate.byteLength,
      }),
      actual: Object.freeze({
        nodesBefore: before.nodes.size,
        nodesAfter: after.nodes.size,
        retainedFrames:
          input.mode === "real"
            ? (await composition.persistence.sampleLatencyDiagnostics(composition.scope)).historyCount - 1
            : noOpPersistences[0]!.retainedFrameCount() - 1,
        materializerDelta: composition.materializerApplyCount() - materializationsBefore,
        physicalSyncCount: input.mode === "real" ? composition.barrierTracker.snapshot().length : 0,
        requestedCanvasCount: canvasCount,
        openedCanvasShards,
        ownerFullValidateCalls,
        ownerCanonicalStateCalls,
      }),
    })
  } finally {
    for (const opened of sessions) opened.dispose()
    await composition.dispose()
  }
}

async function captureShardState(
  mode: CanvasDuplicateBenchmarkMode,
  real: VerifiedCanvasBenchmarkPersistence,
  noOp: BenchmarkNoOpPersistence,
  scope: Parameters<VerifiedCanvasBenchmarkPersistence["loadReplicaHead"]>[0],
) {
  const persistence = mode === "real" ? real : noOp
  const head = await persistence.loadReplicaHead(scope)
  const historyCount = mode === "real"
    ? (await real.sampleLatencyDiagnostics(scope)).historyCount
    : noOp.retainedFrameCount()
  return Object.freeze({
    historyCount,
    headDigest: head.headDigest,
    canonicalStateDigest: head.canonicalStateDigest,
    frontierDigest: head.frontierDigest,
    fullUpdate: Buffer.from(head.fullUpdate).toString("base64"),
    stateVector: Buffer.from(head.stateVector).toString("base64"),
  })
}

type VerifiedCanvasBenchmarkPersistence = Awaited<
  ReturnType<typeof createVerifiedCanvasBenchmarkComposition>
>["persistence"]

export function canvasBenchmarkId(seed: number) {
  if (!Number.isSafeInteger(seed) || seed < 0 || seed > 0xffffffff) {
    throw new TypeError("Canvas benchmark id seed must be a uint32")
  }
  const bytes = new Uint8Array(16)
  new DataView(bytes.buffer).setUint32(12, seed)
  return parseId128(Buffer.from(bytes).toString("base64url"))
}

async function submitSetupNodes(
  session: MainCollaborationDocumentSession<"canvas">,
  authority: CurrentProtocolAuthority,
  factory: Parameters<typeof resolvedFacts>[0],
  nodeCount: CanvasDuplicateBenchmarkNodeCount,
) {
  for (let offset = 0; offset < nodeCount; offset += 85) {
    const count = Math.min(85, nodeCount - offset)
    const command: CanvasAuthoritativeCommand = Object.freeze({
      kind: "manual-resource-placeholders-create",
      anchor: Object.freeze({ x: 0, y: 0 }),
      items: Object.freeze(
        Array.from({ length: count }, (_, index) =>
          Object.freeze({
            title: `Benchmark source ${offset + index}`,
            expectedClass: "image" as const,
            size: Object.freeze({ width: 240, height: 180 }),
          }),
        ),
      ),
      relation: null,
    })
    await session.submit({
      prepare: ({ base, context }) => {
        const snapshot = canvasSnapshotFromValidatedOwnerState(base)
        const constructed = constructCanvasAuthoritativeIntent({ snapshot, context, command })
        if (constructed === "rejected") throw new Error("Canvas benchmark setup construction was rejected")
        return {
          typedIntent: constructed.intent,
          externalFacts: resolvedFacts(factory, authority, constructed.dependencies),
        }
      },
    })
  }
}

function groupStages(
  diagnostic: CollaborationLatencyDiagnostic,
  processedSetSizes: CanvasDuplicateBenchmarkResult["stages"]["queue"]["processedSetSizes"],
): CanvasDuplicateBenchmarkResult["stages"] {
  const grouped: Record<
    (typeof durableBusinessStages)[number],
    readonly (keyof CollaborationLatencyDiagnostic["stages"])[]
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
    object: ["object"],
    outbox: ["outbox"],
    journal: ["journal"],
    head: ["head"],
    "post-head-check": ["post-head-check"],
    "replica-apply": ["replica-apply"],
    projection: ["projection"],
  }
  return Object.freeze(
    Object.fromEntries(
      durableBusinessStages.map((name) => [
        name,
        Object.freeze({
          durationMs: grouped[name].reduce((sum, stage) => sum + diagnostic.stages[stage].durationMs, 0),
          callCount: grouped[name].reduce((sum, stage) => sum + diagnostic.stages[stage].callCount, 0),
          processedSetSizes,
        }),
      ]),
    ),
  ) as CanvasDuplicateBenchmarkResult["stages"]
}

async function submitCommand(
  session: MainCollaborationDocumentSession<"canvas">,
  authority: CurrentProtocolAuthority,
  factory: Parameters<typeof resolvedFacts>[0],
  command: CanvasApplicationCommand,
) {
  return session.submit({
    prepare: ({ base, context }) => {
      const snapshot = canvasSnapshotFromValidatedOwnerState(base)
      const request: CanvasApplicationCommandRequest = {
        scopeId: "canvas-benchmark",
        canvasId: session.scope.docId,
        envelope: {
          actor: { kind: "agent", id: "canvas-benchmark" },
          command,
          commandId: `canvas-benchmark-${context.operationId}`,
        },
      }
      const adapted = adaptCanvasApplicationCommand({ request, snapshot, context })
      if (adapted === "rejected") throw new Error(`Canvas benchmark command ${command.type} was rejected`)
      const constructed = constructCanvasAuthoritativeIntent({ snapshot, context, command: adapted.command })
      if (constructed === "rejected")
        throw new Error(`Canvas benchmark command ${command.type} construction was rejected`)
      return {
        typedIntent: constructed.intent,
        externalFacts: resolvedFacts(factory, authority, constructed.dependencies),
      }
    },
  })
}

function resolvedFacts(
  factory: import("@convax/collaboration").OwnerExternalFactPortFactory<"canvas">,
  authority: CurrentProtocolAuthority,
  dependencies: OwnerIntentDependencies<"canvas">,
): OwnerExternalFactPort<"canvas"> {
  const artifacts = new Map(selectedArtifactMaterial(authority).map((entry) => [entry.artifact.artifactDigest, entry]))
  const created = factory.createAttemptPort({
    declared: dependencies,
    resolver: {
      owner: "canvas",
      resolveArtifact(requirement) {
        const material = artifacts.get(requirement.artifact.artifactDigest)
        return material
          ? Object.freeze({ status: "resolved" as const, requirement, material })
          : Object.freeze({ status: "rejected" as const, code: "artifact-not-declared" as const })
      },
      resolveFact: () => Object.freeze({ status: "rejected" as const, code: "fact-not-declared" as const }),
    },
  })
  if (created.status !== "created") throw new Error("Canvas benchmark fact port was rejected")
  return created.port
}

function selectedArtifactMaterial(authority: CurrentProtocolAuthority) {
  const ownerByName = new Map([
    ["canvas-schema", "canvas"],
    ["collaboration-kernel", "kernel"],
    ["control-plane", "control-plane"],
    ["project-persistence", "project-index"],
  ] as const)
  return authority.protocolSchemaBundle.core.artifacts.map((selected) => {
    const owner = ownerByName.get(selected.name)
    if (!owner) throw new Error(`Unsupported benchmark artifact ${selected.name}`)
    const artifact = Object.freeze({ owner, format: selected.format, artifactDigest: selected.artifactDigest })
    return Object.freeze({
      artifact,
      exactBytes: encodeRestrictedJcs(Object.freeze({ format: "convax.selected-protocol-schema-artifact", artifact })),
    })
  })
}
