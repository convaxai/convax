import { afterEach, describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import {
  CANVAS_PROTOCOL_SCHEMA_ARTIFACT_DIGEST,
  createCanvasDocumentOwnerRuntime,
  createCanvasReconstructionYDoc,
  derivedNodeRef,
  installCanvasGenesisProofCarrierVerifierFactory,
  projectCanvas,
  validateCanvasYDoc,
  type CanvasGenesisBuildAuthor,
  type CanvasTypedIntentUnion,
} from "@convax/canvas/collaboration"
import {
  CollaborationKernel,
  applyYjsUpdate,
  encodeBase64url,
  inspectAcceptedFrameObject,
  installCurrentProtocolAuthority,
  localOwnerEditAuthorizationCoreDigest,
  materializeAcceptedFrame,
  parseActorId,
  parseCanvasId,
  parseDigest,
  parseId128,
  parseMemberId,
  parseReplicaId,
  parseSignature,
  parseUint32,
  parseUint64,
  replicaActorHeadSetDigest,
  type ActorId,
  type Digest,
  type DocumentOwnerRuntime,
  type DocumentScope,
  type Id128,
  type LocalAuthorityPort,
  type LocalFrameAuthority,
  type ReplicaId,
  type ValidationArtifactSet,
  type CurrentProtocolAuthority,
} from "@convax/collaboration"
import * as Y from "yjs"

import {
  createProjectIndexDocumentOwnerRuntime,
  createProjectIndexReconstructionYDoc,
  projectCanvasRouteProjection,
  validateProjectIndexYDoc,
} from "../../collaboration/project-index"
import { UnsupportedProjectDataError } from "./portable-cutover"
import {
  NodeCollaborationPersistence,
  NodeCollaborationPersistenceError,
  type InitializeNativeCollaborationShardWithGenesisProof,
  type NodeAcceptedReplicaHead,
  type NodeReplicaHeadMaterializer,
} from "./persistence-store"
import { readProjectNativeStoreManifest } from "./project-index-genesis-store"
import {
  createImmediatePredecessorCurrentStorePort,
  createImmediatePredecessorProjectMigrationPort,
  type ImmediatePredecessorCurrentAuthorityBinding,
  type ImmediatePredecessorCurrentGenesisAuthorPort,
  type ImmediatePredecessorProjectMigrationAuthorityPort,
} from "./immediate-predecessor-project-migration"

const roots: string[] = []
const fixtureUrl = new URL("./test-fixtures/immediate-predecessor-project-db8b264aa.json", import.meta.url)
const signature = parseSignature(encodeBase64url(Uint8Array.from(
  { length: 64 },
  (_, index) => index === 0 || index === 32 ? 2 : 0,
)))
const currentActorId = actor(201)
const currentMemberId = parseMemberId(encoded(200, 16))
const currentReplicaId = parseReplicaId("replica_000000c9")
const currentAuthorizationDigest = digest("current-local-owner-binding")
const currentOperationId = id(202)

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })))
})

describe.skipIf(process.platform === "win32")("real db8b264aa immediate-predecessor Project migration", () => {
  test("silently imports the exact non-empty Project, omits retired Canvas bytes, then edits and reopens current", async () => {
    const fixture = await loadFixture()
    expect(fixture.files.some((entry) => entry.path.includes("/journals/segments/"))).toBeTrue()
    expect(fixture.files.some((entry) => entry.path.endsWith("/journals/accepted-frames.wal"))).toBeFalse()
    const projectRoot = await materializeFixture(fixture, "success")
    const userDataBefore = await fs.readFile(path.join(projectRoot, "README.md"), "utf8")
    const kit = createCurrentStoreKit()
    const port = createImmediatePredecessorProjectMigrationPort({
      authority: successfulLocalOwnerAuthority(fixture),
      currentStore: kit.port,
      runtime: closedRuntime(),
    })

    expect(await port.ensureCurrent({ projectId: fixture.projectId, projectRoot }))
      .toEqual({ status: "migrated" })
    expect(await fs.readFile(path.join(projectRoot, "README.md"), "utf8")).toBe(userDataBefore)
    expect((await fs.readdir(path.join(projectRoot, ".convax"))).sort()).toEqual(["collaboration"])

    const collaborationDirectory = path.join(projectRoot, ".convax", "collaboration")
    const manifest = await readProjectNativeStoreManifest(collaborationDirectory, kit.port.authority)
    if (manifest.migrationImportBaseProofDigest === null) throw new Error("migration proof is missing")
    await kit.port.verifyCurrentStore({
      projectId: fixture.projectId,
      collaborationDirectory,
      migrationImportBaseProofDigest: manifest.migrationImportBaseProofDigest,
      expectedAuthority: currentAuthorityBinding(),
    })
    const semantics = await readCurrentSemantics(kit, fixture, collaborationDirectory)
    expect(semantics.routes).toEqual([...fixture.expected.routes])
    expect(semantics.canvases).toEqual(fixture.expected.canvases.map((canvas) => ({
      ...canvas,
      nodeTitles: [...canvas.nodeTitles],
    })))
    expect(semantics.retiredMissing).toBeTrue()

    const editedScope = fixture.expected.canvases[0]!.scope
    await commitCurrentCanvasNode(kit, collaborationDirectory, editedScope, "post-migration-edit")
    const reopened = await readCurrentCanvas(kit, collaborationDirectory, editedScope)
    expect(projectCanvas(reopened.snapshot).nodes.map((node) => node.data.title).sort()).toEqual([
      ...fixture.expected.canvases[0]!.nodeTitles,
      "post-migration-edit",
    ].sort())
    expect(reopened.snapshot.operations.size).toBe(fixture.expected.canvases[0]!.operationCount + 1)
    reopened.document.destroy()

    const coldPort = createImmediatePredecessorProjectMigrationPort({
      authority: authorityThatMustNotRun(),
      currentStore: kit.port,
      runtime: closedRuntime(),
    })
    await expect(coldPort.ensureCurrent({ projectId: fixture.projectId, projectRoot }))
      .resolves.toEqual({ status: "current" })
  })

  test.each(["unknown-manifest", "corrupt-checkpoint", "authority-unavailable", "team-unavailable"] as const)(
    "%s leaves Project bytes, user data and owner state untouched",
    async (scenario) => {
      const fixture = await loadFixture()
      const projectRoot = await materializeFixture(fixture, scenario)
      const ownerRoot = await fs.mkdtemp(path.join(os.tmpdir(), `convax-migration-owner-${scenario}-`))
      roots.push(ownerRoot)
      await fs.writeFile(path.join(ownerRoot, "sentinel"), "owner-state")
      if (scenario === "unknown-manifest") {
        const manifest = path.join(projectRoot, ".convax", "collaboration", "manifest-v2.bin")
        const bytes = await fs.readFile(manifest)
        bytes[0] ^= 0xff
        await fs.writeFile(manifest, bytes)
      }
      if (scenario === "corrupt-checkpoint") {
        const checkpoint = path.join(projectRoot, fixture.files.find((entry) => entry.path.includes("/objects/checkpoints/"))!.path)
        const bytes = await fs.readFile(checkpoint)
        bytes[bytes.length - 1] ^= 0xff
        await fs.writeFile(checkpoint, bytes)
      }
      const projectBefore = await exactTree(projectRoot)
      const ownerBefore = await exactTree(ownerRoot)
      let networkCalls = 0
      const kit = createCurrentStoreKit()
      const authority = scenario === "authority-unavailable"
        ? unavailableInspectionAuthority()
        : scenario === "team-unavailable"
          ? unavailableTeamCurrentAuthority(fixture, () => { networkCalls += 1 })
          : successfulLocalOwnerAuthority(fixture)
      const port = createImmediatePredecessorProjectMigrationPort({
        authority,
        currentStore: kit.port,
        runtime: closedRuntime(),
      })

      await expect(port.ensureCurrent({ projectId: fixture.projectId, projectRoot }))
        .rejects.toBeInstanceOf(UnsupportedProjectDataError)
      expect(await exactTree(projectRoot)).toEqual(projectBefore)
      expect(await exactTree(ownerRoot)).toEqual(ownerBefore)
      expect(networkCalls).toBe(scenario === "team-unavailable" ? 1 : 0)
    },
  )
})

function createCurrentStoreKit(): {
  readonly authority: CurrentProtocolAuthority
  readonly port: ReturnType<typeof createImmediatePredecessorCurrentStorePort>
  readonly materializer: NodeReplicaHeadMaterializer
  readonly canvasRuntime: DocumentOwnerRuntime<"canvas">
} {
  const authority = installCurrentProtocolAuthority()
  const canvasRuntime = createCanvasDocumentOwnerRuntime(authority)
  const projectRuntime = createProjectIndexDocumentOwnerRuntime(authority)
  const authorFor = (binding: ImmediatePredecessorCurrentAuthorityBinding): CanvasGenesisBuildAuthor => Object.freeze({
    checkpointId: id(210),
    authorMemberId: binding.memberId,
    authorReplicaId: binding.replicaId,
    authorActorId: binding.actorId,
    authorAuthorizationDigest: binding.authorizationDigest,
    authorAuthorityKind: binding.mode,
    authorAuthorityDigest: binding.authorityDigest,
    authorAuthorityExactBytes: new TextEncoder().encode("current-migration-authority"),
    validationArtifacts: artifactMaterials(authority).artifacts.map((artifact) => Object.freeze({
      artifact,
      exactBytes: new TextEncoder().encode(`selected:${artifact.owner}:${artifact.artifactDigest}`),
    })),
    signCheckpointCoreDigest: async () => signature,
  })
  const canvasVerifierFactory = installCanvasGenesisProofCarrierVerifierFactory({
    authority,
    historicalAuthorVerifier: {
      verifyHistoricalAuthor(input) {
        if (
          input.checkpoint.core.authorActorId !== currentActorId ||
          input.checkpoint.core.authorMemberId !== currentMemberId ||
          input.checkpoint.core.authorReplicaId !== currentReplicaId ||
          input.checkpoint.core.authorAuthorizationDigest !== currentAuthorizationDigest ||
          input.authorAuthorityDigest !== currentAuthorizationDigest
        ) return Object.freeze({ status: "rejected" as const })
        return Object.freeze({
          status: "verified" as const,
          authorActorId: currentActorId,
          authorReplicaId: currentReplicaId,
          authorAuthorityDigest: currentAuthorizationDigest,
        })
      },
    },
  })
  const createdVerifier = canvasVerifierFactory.createVerifier(canvasRuntime)
  if (createdVerifier.status !== "created") throw new Error(createdVerifier.code)
  const materializer = createCurrentMaterializer(authority, projectRuntime, canvasRuntime)
  const authors: ImmediatePredecessorCurrentGenesisAuthorPort = Object.freeze({
    async prepareProjectIndexAuthor(
      { expectedAuthority }: Parameters<ImmediatePredecessorCurrentGenesisAuthorPort["prepareProjectIndexAuthor"]>[0],
    ) {
      assertCurrentAuthority(expectedAuthority)
      return Object.freeze({ checkpointId: id(212), signCheckpointCoreDigest: async () => signature })
    },
    async prepareCanvasAuthor(
      { expectedAuthority }: Parameters<ImmediatePredecessorCurrentGenesisAuthorPort["prepareCanvasAuthor"]>[0],
    ) {
      assertCurrentAuthority(expectedAuthority)
      return authorFor(expectedAuthority)
    },
    async verifyProjectIndexCheckpoint(
      { checkpoint, expectedAuthority }: Parameters<ImmediatePredecessorCurrentGenesisAuthorPort["verifyProjectIndexCheckpoint"]>[0],
    ) {
      assertCurrentAuthority(expectedAuthority)
      return checkpoint.core.authorActorId === expectedAuthority.actorId &&
        checkpoint.core.authorMemberId === expectedAuthority.memberId &&
        checkpoint.core.authorReplicaId === expectedAuthority.replicaId &&
        checkpoint.core.authorAuthorizationDigest === expectedAuthority.authorizationDigest
    },
  })
  const port = createImmediatePredecessorCurrentStorePort({
    authority,
    materializer,
    canvasRuntime,
    canvasProofVerifier: createdVerifier.verifier,
    authors,
  })
  return Object.freeze({ authority, port, materializer, canvasRuntime })
}

function createCurrentMaterializer(
  authority: CurrentProtocolAuthority,
  projectRuntime: DocumentOwnerRuntime<"project-index">,
  canvasRuntime: DocumentOwnerRuntime<"canvas">,
): NodeReplicaHeadMaterializer {
  return Object.freeze({
    async inspectFrame(
      ref: Parameters<NodeReplicaHeadMaterializer["inspectFrame"]>[0],
      exactBytes: Parameters<NodeReplicaHeadMaterializer["inspectFrame"]>[1],
    ) {
      inspectAcceptedFrameObject(authority, ref, exactBytes)
      return Object.freeze({ ref, requiredBlobDigests: Object.freeze([]) })
    },
    async applyAcceptedFrame(
      { previous, ref, exactBytes, durableDelta }: Parameters<NodeReplicaHeadMaterializer["applyAcceptedFrame"]>[0],
    ) {
      return materializeAcceptedFrame({
        authority,
        owner: ref.scope.docKind === "project-index" ? projectRuntime : canvasRuntime,
        previous,
        ref,
        exactFrameBytes: exactBytes,
        durableDelta,
        causalClosure: { contains: (descendant, ancestor) => descendant === ancestor },
        createDocument: ref.scope.docKind === "project-index"
          ? createProjectIndexReconstructionYDoc
          : createCanvasReconstructionYDoc,
      })
    },
    actorHeadsDigest: replicaActorHeadSetDigest,
  })
}

async function readCurrentSemantics(
  kit: ReturnType<typeof createCurrentStoreKit>,
  fixture: Fixture,
  collaborationDirectory: string,
) {
  const persistence = await NodeCollaborationPersistence.openReadOnly({
    collaborationDirectory,
    localActorId: currentActorId,
    materializer: kit.materializer,
  })
  try {
    const projectHead = await persistence.loadReplicaHead(fixture.projectIndexScope) as NodeAcceptedReplicaHead
    const projectDocument = reconstructProjectIndex(projectHead.fullUpdate)
    try {
      const project = validateProjectIndexYDoc(projectDocument, fixture.projectIndexScope)
      const routes = fixture.expected.routes.map(({ canvasId }) => {
        const route = projectCanvasRouteProjection(project, parseCanvasId(canvasId))
        return Object.freeze({
          canvasId,
          state: route.state,
          title: route.currentTitle,
          shardEpoch: route.currentShardEpoch,
        })
      })
      const canvases = []
      for (const expected of fixture.expected.canvases) {
        const head = await persistence.loadReplicaHead(expected.scope) as NodeAcceptedReplicaHead
        const document = reconstructCanvas(head.fullUpdate)
        try {
          const snapshot = validateCanvasYDoc(document, expected.scope)
          canvases.push(Object.freeze({
            scope: expected.scope,
            nodeTitles: projectCanvas(snapshot).nodes.map((node) => node.data.title).sort(),
            operationCount: snapshot.operations.size,
          }))
        } finally {
          document.destroy()
        }
      }
      let retiredMissing = false
      try {
        await persistence.loadReplicaHead(fixture.expected.retiredCanvas.scope)
      } catch (error) {
        retiredMissing = error instanceof NodeCollaborationPersistenceError && error.code === "document-not-found"
      }
      return Object.freeze({ routes, canvases, retiredMissing })
    } finally {
      projectDocument.destroy()
    }
  } finally {
    persistence.dispose()
  }
}

async function commitCurrentCanvasNode(
  kit: ReturnType<typeof createCurrentStoreKit>,
  collaborationDirectory: string,
  scope: DocumentScope & { readonly docKind: "canvas" },
  title: string,
): Promise<void> {
  const persistence = await NodeCollaborationPersistence.open({
    collaborationDirectory,
    localActorId: currentActorId,
    materializer: kit.materializer,
  })
  const facts = () => {
    const created = kit.canvasRuntime.externalFactPortFactory.createAttemptPort({
      declared: { validationArtifacts: [], externalFacts: [] },
      resolver: {
        owner: "canvas",
        resolveArtifact: (ref) => ({ status: "pending" as const, ref }),
        resolveFact: (requirement) => ({ status: "pending" as const, requirement }),
      },
    })
    if (created.status !== "created") throw new Error(created.code)
    return created.port
  }
  const authorizationCore = Object.freeze({
    format: "convax.local-owner-edit-authorization-core" as const,
    scope,
    replicaId: currentReplicaId,
    actorId: currentActorId,
    ownerBindingDigest: currentAuthorizationDigest,
    protocolDigest: kit.authority.protocolDigest,
    ownerSchemaDigest: CANVAS_PROTOCOL_SCHEMA_ARTIFACT_DIGEST,
    expiryPolicy: "none" as const,
  })
  const editAuthorizationDigest = localOwnerEditAuthorizationCoreDigest(authorizationCore)
  const localAuthority: LocalAuthorityPort = {
    actorId: currentActorId,
    async prepareFinalFrameAuthority(
      input: Parameters<LocalAuthorityPort["prepareFinalFrameAuthority"]>[0],
    ): Promise<LocalFrameAuthority> {
      return Object.freeze({
        actorId: currentActorId,
        actorSequence: parseUint64(input.previousActorHead ? String(BigInt(input.previousActorHead.actorSequence) + 1n) : "1"),
        predecessorFrameDigest: input.previousActorHead?.frameDigest ?? null,
        signerAuthority: Object.freeze({
          kind: "local-project-owner" as const,
          replicaId: currentReplicaId,
          actorId: currentActorId,
          ownerBindingDigest: currentAuthorizationDigest,
          ownerEditAuthorizationCoreDigest: editAuthorizationDigest,
        }),
        dependencies: Object.freeze([
          { kind: "local-owner-binding" as const, digest: currentAuthorizationDigest },
          { kind: "local-owner-edit-authorization" as const, digest: editAuthorizationDigest },
        ]),
        validationArtifacts: artifactMaterials(kit.authority),
        signer: Object.freeze({ sign: async () => signature }),
      })
    },
  }
  try {
    const kernel = await CollaborationKernel.open({
      authority: kit.authority,
      scope,
      owner: kit.canvasRuntime,
      signatureVerifier: { verify: async () => true },
      ports: {
        createDocument: createCanvasReconstructionYDoc,
        persistence,
        localAuthority,
        incomingAuthority: { verifyFrameAuthority: async () => ({ replicaPublicKey: encoded(220, 32) as never }) },
        incomingFacts: { resolve: async () => ({ status: "resolved" as const, port: facts() }) },
        exactBaseResolver: { reconstructExactBase: async () => "pending" as const },
        causalClosure: { contains: (descendant, ancestor) => descendant === ancestor },
        pendingInbox: persistence,
      },
    })
    try {
      await kernel.commitLocalIntent({
        operationId: id(221),
        prepare: ({ context }) => {
          const ordinal = parseUint32("0")
          const node = derivedNodeRef(context, ordinal)
          const typedIntent: Extract<CanvasTypedIntentUnion, { kind: "canvas.agent.create" }> = Object.freeze({
            format: "convax.typed-intent",
            kind: "canvas.agent.create",
            guard: Object.freeze({ ordinal, node, expectedAbsent: true }),
            body: Object.freeze({
              node: Object.freeze({
                ordinal,
                nodeId: node.id,
                incarnation: node.incarnation,
                role: "agent",
                position: Object.freeze({ x: 900, y: 0 }),
                size: Object.freeze({ width: 240, height: 120 }),
                data: Object.freeze({ format: "convax.canvas-node-data", kind: "agent", title, instructions: null }),
                plugin: null,
              }),
            }),
          })
          return Object.freeze({ typedIntent, externalFacts: facts() })
        },
      })
    } finally {
      kernel.dispose()
    }
  } finally {
    persistence.dispose()
  }
}

async function readCurrentCanvas(
  kit: ReturnType<typeof createCurrentStoreKit>,
  collaborationDirectory: string,
  scope: DocumentScope & { readonly docKind: "canvas" },
) {
  const persistence = await NodeCollaborationPersistence.openReadOnly({
    collaborationDirectory,
    localActorId: currentActorId,
    materializer: kit.materializer,
  })
  try {
    const head = await persistence.loadReplicaHead(scope) as NodeAcceptedReplicaHead
    const document = reconstructCanvas(head.fullUpdate)
    return Object.freeze({ document, snapshot: validateCanvasYDoc(document, scope) })
  } finally {
    persistence.dispose()
  }
}

function successfulLocalOwnerAuthority(fixture: Fixture): ImmediatePredecessorProjectMigrationAuthorityPort {
  return Object.freeze({
    async inspectPredecessor() {
      return Object.freeze({
        status: "verified" as const,
        mode: "local-project-owner" as const,
        predecessorLocalActorId: parseActorId(fixture.predecessorLocalActorId),
        predecessorReplicaId: parseReplicaId("replica_0000002a"),
        predecessorSignatures: Object.freeze({
          verify: async () => true,
          verifyCheckpoint: async () => true,
        }),
      })
    },
    async prepareCurrent() {
      return Object.freeze({
        status: "authorized" as const,
        mode: "local-project-owner" as const,
        actorId: currentActorId,
        memberId: currentMemberId,
        replicaId: currentReplicaId,
        authorizationDigest: currentAuthorizationDigest,
        authorityDigest: currentAuthorizationDigest,
        migrationOperationId: currentOperationId,
      })
    },
  })
}

function unavailableInspectionAuthority(): ImmediatePredecessorProjectMigrationAuthorityPort {
  return Object.freeze({
    inspectPredecessor: async () => Object.freeze({ status: "unavailable" as const }),
    prepareCurrent: async () => { throw new Error("unavailable predecessor must not prepare current authority") },
  })
}

function unavailableTeamCurrentAuthority(fixture: Fixture, observed: () => void): ImmediatePredecessorProjectMigrationAuthorityPort {
  const verified = successfulLocalOwnerAuthority(fixture)
  return Object.freeze({
    async inspectPredecessor(
      input: Parameters<ImmediatePredecessorProjectMigrationAuthorityPort["inspectPredecessor"]>[0],
    ) {
      const result = await verified.inspectPredecessor(input)
      if (result.status !== "verified") return result
      return Object.freeze({ ...result, mode: "team-replica" as const })
    },
    async prepareCurrent() {
      observed()
      return Object.freeze({ status: "unavailable" as const })
    },
  })
}

function authorityThatMustNotRun(): ImmediatePredecessorProjectMigrationAuthorityPort {
  return Object.freeze({
    inspectPredecessor: async () => { throw new Error("current Project must not inspect predecessor authority") },
    prepareCurrent: async () => { throw new Error("current Project must not prepare migration authority") },
  })
}

function currentAuthorityBinding(): ImmediatePredecessorCurrentAuthorityBinding {
  return Object.freeze({
    mode: "local-project-owner",
    actorId: currentActorId,
    memberId: currentMemberId,
    replicaId: currentReplicaId,
    authorizationDigest: currentAuthorizationDigest,
    authorityDigest: currentAuthorizationDigest,
  })
}

function assertCurrentAuthority(value: ImmediatePredecessorCurrentAuthorityBinding): void {
  if (
    value.mode !== "local-project-owner" ||
    value.actorId !== currentActorId ||
    value.memberId !== currentMemberId ||
    value.replicaId !== currentReplicaId ||
    value.authorizationDigest !== currentAuthorizationDigest ||
    value.authorityDigest !== currentAuthorizationDigest
  ) throw new TypeError("test current authority changed")
}

function closedRuntime() {
  return Object.freeze({
    async runClosed<Result>(input: Readonly<{ operation(): Promise<Result> }>) { return input.operation() },
  })
}

function reconstructProjectIndex(fullUpdate: Readonly<Uint8Array>) {
  const document = createProjectIndexReconstructionYDoc()
  applyYjsUpdate(document, fullUpdate, Object.freeze({ format: "migration-e2e-project-index" }))
  return document
}

function reconstructCanvas(fullUpdate: Readonly<Uint8Array>) {
  const document = createCanvasReconstructionYDoc()
  applyYjsUpdate(document, fullUpdate, Object.freeze({ format: "migration-e2e-canvas" }))
  return document
}

function artifactMaterials(authority: CurrentProtocolAuthority): ValidationArtifactSet {
  const owners = new Map([
    ["canvas-schema", "canvas"],
    ["collaboration-kernel", "kernel"],
    ["control-plane", "control-plane"],
    ["project-persistence", "project-index"],
  ] as const)
  return Object.freeze({
    format: "convax.validation-artifact-set",
    artifacts: Object.freeze(authority.protocolSchemaBundle.core.artifacts.map((artifact) => Object.freeze({
      owner: owners.get(artifact.name)!,
      format: artifact.format,
      artifactDigest: artifact.artifactDigest,
    })).sort((left, right) => left.owner.localeCompare(right.owner))),
  })
}

async function loadFixture(): Promise<Fixture> {
  const parsed = JSON.parse(await fs.readFile(fixtureUrl, "utf8")) as Fixture
  if (
    parsed.format !== "convax.immediate-predecessor-project-fixture/1" ||
    parsed.sourceCommit !== "db8b264aa" ||
    parsed.sourceProtocolDigest !== "8295f918e8f7b8297c080db03672fc410542280f639d9b40a8e324e560f07ae9"
  ) throw new TypeError("immediate-predecessor fixture identity changed")
  return parsed
}

async function materializeFixture(fixture: Fixture, label: string): Promise<string> {
  const created = await fs.mkdtemp(path.join(os.tmpdir(), `convax-db8-migration-${label}-`))
  roots.push(created)
  const projectRoot = await fs.realpath(created)
  for (const file of fixture.files) {
    const bytes = Buffer.from(file.base64, "base64")
    if (createHash("sha256").update(bytes).digest("hex") !== file.sha256) {
      throw new TypeError(`fixture file digest mismatches: ${file.path}`)
    }
    const target = path.join(projectRoot, ...file.path.split("/"))
    await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o700 })
    await fs.writeFile(target, bytes, { flag: "wx", mode: 0o600 })
  }
  return projectRoot
}

async function exactTree(root: string) {
  const entries: Array<Readonly<{ path: string; kind: "directory" | "file"; sha256?: string }>> = []
  const visit = async (directory: string): Promise<void> => {
    for (const entry of (await fs.readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const target = path.join(directory, entry.name)
      const relative = path.relative(root, target).split(path.sep).join("/")
      if (entry.isDirectory()) {
        entries.push(Object.freeze({ path: relative, kind: "directory" }))
        await visit(target)
      } else if (entry.isFile()) {
        entries.push(Object.freeze({
          path: relative,
          kind: "file",
          sha256: createHash("sha256").update(await fs.readFile(target)).digest("hex"),
        }))
      } else throw new TypeError("test tree contains a non-file")
    }
  }
  await visit(root)
  return entries
}

interface Fixture {
  readonly format: "convax.immediate-predecessor-project-fixture/1"
  readonly sourceCommit: "db8b264aa"
  readonly sourceProtocolDigest: string
  readonly projectId: string
  readonly projectIndexScope: DocumentScope & { readonly docKind: "project-index"; readonly docId: "project-index" }
  readonly predecessorLocalActorId: string
  readonly expected: Readonly<{
    routes: readonly Readonly<{
      canvasId: `cv_${string}`
      state: "live" | "tombstoned"
      title: string | null
      shardEpoch: Id128 | null
    }>[]
    canvases: readonly Readonly<{
      scope: DocumentScope & { readonly docKind: "canvas" }
      nodeTitles: readonly string[]
      operationCount: number
    }>[]
    retiredCanvas: Readonly<{
      scope: DocumentScope & { readonly docKind: "canvas" }
      nodeTitles: readonly string[]
      operationCount: number
    }>
  }>
  readonly files: readonly Readonly<{ path: string; sha256: string; base64: string }>[]
}

function actor(seed: number): ActorId { return parseActorId(encoded(seed, 32)) }
function id(seed: number): Id128 { return parseId128(encoded(seed, 16)) }
function encoded(seed: number, length: number) { return encodeBase64url(Uint8Array.from({ length }, (_, index) => (seed * 17 + index * 29) & 0xff)) }
function digest(value: string): Digest { return parseDigest(createHash("sha256").update(value).digest("hex")) }
