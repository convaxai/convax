import path from "node:path"
import fs from "node:fs/promises"
import {
  applyYjsUpdate,
  acceptedHeadMaterializedStateDigest,
  decodeRestrictedJcs,
  encodeRestrictedJcs,
  parseActorId,
  parseDigest,
  parseDocumentScope,
  parseId128,
  parseMemberId,
  parseProjectId,
  parseReplicaId,
  parseReplicaCheckpoint,
  replicaCheckpointCoreDigest,
  stateVectorDigest,
  structuredDigest,
  yjsUpdateDigest,
  type ActorId,
  type CurrentProtocolAuthority,
  type Digest,
  type DocumentOwnerRuntime,
  type DocumentScope,
  type Id128,
  type MemberId,
  type ReplicaId,
  type ReplicaCheckpoint,
  type Signature,
} from "@convax/collaboration"
import type {
  ImmediatePredecessorCheckpointSignatureVerifier,
  ImmediatePredecessorSignatureVerifier,
} from "@convax/collaboration/migration"
import {
  createCanvasReconstructionYDoc,
  validateCanvasYDoc,
  type ValidatedCanvasGenesisIdentity,
} from "@convax/canvas/collaboration"
import {
  buildImmediatePredecessorImportedCanvasGenesisProofCarrier,
  immediatePredecessorCanvasCanonicalStateDigest,
  rebuildImmediatePredecessorCanvasDocument,
  type CanvasGenesisBuildAuthor,
  type CanvasGenesisProofCarrierVerifier,
} from "@convax/canvas/collaboration-migration"
import * as Y from "yjs"

import {
  immediatePredecessorProjectIndexCanonicalStateDigest,
  inspectImmediatePredecessorProjectIndexCanvasInventory,
  rebuildImmediatePredecessorProjectIndexDocument,
} from "../../collaboration/immediate-predecessor-migration"
import {
  PROJECT_INDEX_PROTOCOL_SCHEMA_ARTIFACT_DIGEST,
  createProjectIndexReconstructionYDoc,
  projectCanvasRouteProjection,
  projectIndexRecordDigest,
  validateProjectIndexYDoc,
} from "../../collaboration/project-index"
import type { ImmediatePredecessorProjectMigrationPort } from "../project-manager"
import { UnsupportedProjectDataError } from "./portable-cutover"
import { deriveDocumentNativeKey, deriveObjectNativeKey } from "./native-store-keys"
import {
  NodeCollaborationPersistence,
  openImmediatePredecessorCollaborationStoreReadOnly,
  type InitializeNativeCollaborationShardWithGenesisProof,
  type NodeAcceptedReplicaHead,
  type NodeReplicaHeadMaterializer,
} from "./persistence-store"
import {
  createImmediatePredecessorImportedProjectIndexCheckpointCandidate,
  initializeImmediatePredecessorImportedProjectIndexNativeStoreInPlace,
  readImmediatePredecessorProjectNativeStoreManifest,
  readProjectNativeStoreManifest,
  verifyImmediatePredecessorImportedProjectIndexGenesis,
  type ImmediatePredecessorProjectNativeStoreManifest,
  type ProjectNativeStoreAuthority,
  type VerifiedImmediatePredecessorImportedProjectIndexGenesis,
} from "./project-index-genesis-store"
import {
  migrateImmediatePredecessorCollaborationStore,
  recoverImmediatePredecessorCollaborationCutover,
  type MigrationCurrentAuthorityIdentity,
} from "./immediate-predecessor-cutover"

export type ImmediatePredecessorProjectMigrationPredecessorInspection =
  | Readonly<{ status: "unavailable" | "rejected" }>
  | Readonly<{
      status: "verified"
      mode: "local-project-owner" | "team-replica"
      predecessorLocalActorId: ActorId
      predecessorReplicaId: ReplicaId
      predecessorSignatures: ImmediatePredecessorSignatureVerifier & ImmediatePredecessorCheckpointSignatureVerifier
    }>

export type ImmediatePredecessorProjectMigrationCurrentAuthority =
  | Readonly<{ status: "unavailable" | "rejected" }>
  | Readonly<{
      status: "authorized"
      mode: "local-project-owner" | "team-replica"
      actorId: ActorId
      memberId: MemberId
      replicaId: ReplicaId
      authorizationDigest: Digest
      authorityDigest: Digest
      migrationOperationId: Id128
    }>

export interface ImmediatePredecessorProjectMigrationAuthorityPort {
  /** Pure read-only classification and predecessor signature verification. */
  inspectPredecessor(input: Readonly<{
    projectId: string
    projectRoot: string
    predecessorManifest: ImmediatePredecessorProjectNativeStoreManifest
  }>): Promise<ImmediatePredecessorProjectMigrationPredecessorInspection>
  /** May issue retry-stable current authority only after the full source closure was verified. */
  prepareCurrent(input: Readonly<{
    projectId: string
    projectRoot: string
    predecessorManifest: ImmediatePredecessorProjectNativeStoreManifest
    sourceClosureDigest: Digest
    predecessor: Extract<ImmediatePredecessorProjectMigrationPredecessorInspection, { status: "verified" }>
  }>): Promise<ImmediatePredecessorProjectMigrationCurrentAuthority>
}

export type ImmediatePredecessorCurrentAuthorityBinding = Readonly<{
  mode: "local-project-owner" | "team-replica"
  actorId: ActorId
  memberId: MemberId
  replicaId: ReplicaId
  authorizationDigest: Digest
  authorityDigest: Digest
}>

export interface ImmediatePredecessorCurrentStorePort {
  readonly authority: ProjectNativeStoreAuthority & Readonly<{ canvasSchemaDigest: Digest }>
  /** Current-only base materializer; it has no predecessor decoder. */
  readonly materializer: NodeReplicaHeadMaterializer
  buildProjectIndexGenesis(input: Readonly<{
    scope: DocumentScope & { readonly docKind: "project-index"; readonly docId: "project-index" }
    document: Y.Doc
    migrationImportBaseProofDigest: Digest
    expectedAuthority: ImmediatePredecessorCurrentAuthorityBinding
  }>): Promise<VerifiedImmediatePredecessorImportedProjectIndexGenesis>
  buildCanvasGenesis(input: Readonly<{
    scope: DocumentScope & { readonly docKind: "canvas" }
    document: Y.Doc
    migrationImportBaseProofDigest: Digest
    expectedAuthority: ImmediatePredecessorCurrentAuthorityBinding
  }>): Promise<Readonly<{
    genesis: InitializeNativeCollaborationShardWithGenesisProof
    projectIndexRouteDependency: Readonly<{ kind: "migration-import-base"; digest: Digest }>
  }>>
  /** Full current-only reopen: manifest, PI, every live Canvas and proof carrier. */
  verifyCurrentStore(input: Readonly<{
    projectId: string
    collaborationDirectory: string
    migrationImportBaseProofDigest?: Digest
    expectedAuthority?: ImmediatePredecessorCurrentAuthorityBinding
  }>): Promise<void>
}

export interface ImmediatePredecessorCurrentGenesisAuthorPort {
  prepareProjectIndexAuthor(input: Readonly<{
    scope: DocumentScope & { readonly docKind: "project-index"; readonly docId: "project-index" }
    migrationImportBaseProofDigest: Digest
    expectedAuthority: ImmediatePredecessorCurrentAuthorityBinding
  }>): Promise<Readonly<{
    checkpointId: Id128
    signCheckpointCoreDigest(coreDigest: Digest): Promise<Signature>
  }> | "unavailable" | "rejected">
  prepareCanvasAuthor(input: Readonly<{
    scope: DocumentScope & { readonly docKind: "canvas" }
    migrationImportBaseProofDigest: Digest
    expectedAuthority: ImmediatePredecessorCurrentAuthorityBinding
  }>): Promise<CanvasGenesisBuildAuthor | "unavailable" | "rejected">
  verifyProjectIndexCheckpoint(input: Readonly<{
    checkpoint: ReplicaCheckpoint
    expectedAuthority: ImmediatePredecessorCurrentAuthorityBinding
  }>): Promise<boolean>
}

/**
 * Project-owned current import adapter. Desktop supplies only current signing
 * and authority verification; Project retains PI/Canvas genesis and native
 * reopen semantics.
 */
export function createImmediatePredecessorCurrentStorePort(input: Readonly<{
  authority: CurrentProtocolAuthority
  materializer: NodeReplicaHeadMaterializer
  canvasRuntime: DocumentOwnerRuntime<"canvas">
  canvasProofVerifier: CanvasGenesisProofCarrierVerifier
  authors: ImmediatePredecessorCurrentGenesisAuthorPort
}>): ImmediatePredecessorCurrentStorePort {
  const authority = Object.freeze({
    protocolDigest: input.authority.protocolDigest,
    schemaDigest: PROJECT_INDEX_PROTOCOL_SCHEMA_ARTIFACT_DIGEST,
    uriProtocolDigest: input.authority.protocolSchemaBundle.core.uriProtocolDigest,
    canvasSchemaDigest: selectedCanvasSchemaDigest(input.authority),
  })
  return Object.freeze({
    authority,
    materializer: input.materializer,
    async buildProjectIndexGenesis(
      request: Parameters<ImmediatePredecessorCurrentStorePort["buildProjectIndexGenesis"]>[0],
    ) {
      const author = await input.authors.prepareProjectIndexAuthor(request)
      if (typeof author === "string") throw new TypeError(`Current ProjectIndex migration author is ${author}`)
      const candidate = createImmediatePredecessorImportedProjectIndexCheckpointCandidate({
        scope: request.scope,
        document: request.document,
        actorId: request.expectedAuthority.actorId,
        checkpointId: author.checkpointId,
        authorMemberId: request.expectedAuthority.memberId,
        authorReplicaId: request.expectedAuthority.replicaId,
        authorAuthorizationDigest: request.expectedAuthority.authorizationDigest,
        validationArtifactSetDigest: currentValidationArtifactSetDigest(input.authority),
        authority,
        migrationImportBaseProofDigest: request.migrationImportBaseProofDigest,
      })
      const coreDigest = replicaCheckpointCoreDigest(candidate.checkpointCore)
      const checkpoint = parseReplicaCheckpoint({
        format: "convax.replica-checkpoint",
        core: candidate.checkpointCore,
        coreDigest,
        replicaSignature: await author.signCheckpointCoreDigest(coreDigest),
      })
      return verifyImmediatePredecessorImportedProjectIndexGenesis({
        scope: request.scope,
        document: request.document,
        checkpointExactBytes: encodeRestrictedJcs(checkpoint),
        initializationAuthorityDigest: request.expectedAuthority.authorityDigest,
        migrationImportBaseProofDigest: request.migrationImportBaseProofDigest,
        verifier: {
          verify: (value) => input.authors.verifyProjectIndexCheckpoint({
            checkpoint: value,
            expectedAuthority: request.expectedAuthority,
          }),
        },
      })
    },
    async buildCanvasGenesis(
      request: Parameters<ImmediatePredecessorCurrentStorePort["buildCanvasGenesis"]>[0],
    ) {
      const author = await input.authors.prepareCanvasAuthor(request)
      if (typeof author === "string") throw new TypeError(`Current Canvas migration author is ${author}`)
      assertCanvasAuthorMatches(author, request.expectedAuthority)
      const built = await buildImmediatePredecessorImportedCanvasGenesisProofCarrier({
        authority: input.authority,
        runtime: input.canvasRuntime,
        verifier: input.canvasProofVerifier,
        scope: request.scope,
        projectIndexRouteDependencyFrameDigest: request.migrationImportBaseProofDigest,
        author,
        document: request.document,
      })
      if (built.status !== "built") {
        throw new TypeError(`Imported Canvas genesis is ${built.status}${
          built.status === "rejected" && built.code ? ` (${built.code})` : ""
        }`)
      }
      assertValidatedCanvasAuthority(built.validatedIdentity, request.expectedAuthority)
      const acceptedBase = Object.freeze({
        ...built.acceptedBase,
        materializationDigest: acceptedHeadMaterializedStateDigest({
          ...built.acceptedBase,
          headDigest: built.checkpointObjectDigest,
          materializationDigest: built.checkpointObjectDigest,
        }),
      })
      return Object.freeze({
        genesis: Object.freeze({
          scope: request.scope,
          checkpointObjectDigest: built.checkpointObjectDigest,
          checkpointExactBytes: new Uint8Array(built.checkpointExactBytes),
          proofCarrierExactBytes: new Uint8Array(built.proofCarrierExactBytes),
          acceptedBase,
        }),
        projectIndexRouteDependency: Object.freeze({
          kind: "migration-import-base" as const,
          digest: request.migrationImportBaseProofDigest,
        }),
      })
    },
    verifyCurrentStore: (
      request: Parameters<ImmediatePredecessorCurrentStorePort["verifyCurrentStore"]>[0],
    ) => verifyImportedCurrentStore({
      ...request,
      authority,
      materializer: input.materializer,
      canvasProofVerifier: input.canvasProofVerifier,
      authors: input.authors,
    }),
  })
}

async function verifyImportedCurrentStore(input: Readonly<{
  projectId: string
  collaborationDirectory: string
  migrationImportBaseProofDigest?: Digest
  expectedAuthority?: ImmediatePredecessorCurrentAuthorityBinding
  authority: ProjectNativeStoreAuthority & Readonly<{ canvasSchemaDigest: Digest }>
  materializer: NodeReplicaHeadMaterializer
  canvasProofVerifier: CanvasGenesisProofCarrierVerifier
  authors: ImmediatePredecessorCurrentGenesisAuthorPort
}>): Promise<void> {
  const proof = parseDigest(input.migrationImportBaseProofDigest)
  const expectedAuthority = input.expectedAuthority
  if (!expectedAuthority) throw new TypeError("Imported current-store verification requires its exact signer authority")
  const manifest = await readProjectNativeStoreManifest(input.collaborationDirectory, input.authority)
  if (
    manifest.projectIndexScope.projectId !== parseProjectId(input.projectId) ||
    manifest.projectIndexGenesisKind !== "immediate-predecessor-import" ||
    manifest.migrationImportBaseProofDigest !== proof ||
    manifest.initializationAuthorityDigest !== expectedAuthority.authorityDigest
  ) throw new TypeError("Imported current Project manifest differs from its signed migration authority")
  const store = await NodeCollaborationPersistence.openReadOnly({
    collaborationDirectory: input.collaborationDirectory,
    localActorId: expectedAuthority.actorId,
    materializer: input.materializer,
  })
  const documents: Y.Doc[] = []
  try {
    const projectIndexHead = await store.loadReplicaHead(manifest.projectIndexScope) as NodeAcceptedReplicaHead
    const projectIndexDocument = createProjectIndexReconstructionYDoc()
    documents.push(projectIndexDocument)
    applyYjsUpdate(projectIndexDocument, projectIndexHead.fullUpdate, Object.freeze({
      format: "convax.immediate-predecessor-current-project-index-reopen",
    }))
    const snapshot = validateProjectIndexYDoc(projectIndexDocument, manifest.projectIndexScope)
    if (snapshot.identity.migrationImportBaseProofDigest !== proof) {
      throw new TypeError("Signed ProjectIndex owner state differs from its migration manifest proof")
    }
    const checkpointExactBytes = await readProjectIndexGenesisCheckpointExactBytes(
      input.collaborationDirectory,
      manifest.projectIndexScope,
      manifest.projectIndexGenesisCheckpointObjectDigest,
    )
    await verifyImmediatePredecessorImportedProjectIndexGenesis({
      scope: manifest.projectIndexScope,
      document: projectIndexDocument,
      checkpointExactBytes,
      initializationAuthorityDigest: expectedAuthority.authorityDigest,
      migrationImportBaseProofDigest: proof,
      verifier: {
        verify: (checkpoint) => input.authors.verifyProjectIndexCheckpoint({ checkpoint, expectedAuthority }),
      },
    })
    const canvasIds = new Set([...snapshot.canvasRoutes.values()].map((fact) => fact.canvasId))
    for (const canvasId of [...canvasIds].sort()) {
      const projection = projectCanvasRouteProjection(snapshot, canvasId)
      if (projection.state !== "live" || projection.currentShardEpoch === null) continue
      const scope = parseDocumentScope(Object.freeze({
        projectId: manifest.projectIndexScope.projectId,
        projectEpoch: manifest.projectIndexScope.projectEpoch,
        docKind: "canvas",
        docId: canvasId,
        shardEpoch: projection.currentShardEpoch,
      }))
      await store.loadReplicaHead(scope) as NodeAcceptedReplicaHead
      const currentTransition = [...snapshot.canvasRoutes.values()].find((fact) =>
        fact.canvasId === canvasId &&
        (fact.format === "convax.canvas-route-activation" || fact.format === "convax.canvas-route-reset-commit") &&
        projectIndexRecordDigest(fact) === projection.currentActivationDigest)
      if (!currentTransition) throw new TypeError("Current Canvas route lacks its signed genesis transition")
      let checkpointObjectDigest: Digest
      if (currentTransition.format === "convax.canvas-route-activation") {
        checkpointObjectDigest = currentTransition.canvasGenesisCheckpointObjectDigest
      } else if (currentTransition.format === "convax.canvas-route-reset-commit") {
        checkpointObjectDigest = currentTransition.stagedGenesisCheckpointObjectDigest
      } else {
        throw new TypeError("Current Canvas route transition cannot bind a genesis checkpoint")
      }
      const proofCarrier = await store.readGenesisProof(scope, checkpointObjectDigest)
      const verified = input.canvasProofVerifier(proofCarrier)
      if (
        verified.status !== "validated" ||
        verified.identity.checkpointObjectDigest !== checkpointObjectDigest ||
        verified.identity.identity.projectIndexRouteDependency.kind !== "migration-import-base" ||
        verified.identity.identity.projectIndexRouteDependency.digest !== proof
      ) throw new TypeError("Current Canvas genesis differs from its ProjectIndex import proof")
      assertValidatedCanvasAuthority(verified.identity, expectedAuthority)
    }
  } finally {
    store.dispose()
    for (const document of documents) document.destroy()
  }
}

async function readProjectIndexGenesisCheckpointExactBytes(
  collaborationDirectory: string,
  scope: DocumentScope,
  checkpointObjectDigest: Digest,
): Promise<Uint8Array> {
  const target = path.join(
    collaborationDirectory,
    "documents",
    deriveDocumentNativeKey(scope),
    "objects",
    "checkpoints",
    `${deriveObjectNativeKey("checkpoint", checkpointObjectDigest)}.bin`,
  )
  const stat = await fs.lstat(target)
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 1 || stat.size > 64 * 1024 * 1024) {
    throw new TypeError("Imported ProjectIndex checkpoint is not a bounded plain file")
  }
  return new Uint8Array(await fs.readFile(target))
}

function assertCanvasAuthorMatches(
  author: CanvasGenesisBuildAuthor,
  expected: ImmediatePredecessorCurrentAuthorityBinding,
): void {
  if (
    author.authorAuthorityKind !== expected.mode ||
    author.authorMemberId !== expected.memberId ||
    author.authorReplicaId !== expected.replicaId ||
    author.authorActorId !== expected.actorId ||
    author.authorAuthorizationDigest !== expected.authorizationDigest ||
    author.authorAuthorityDigest !== expected.authorityDigest
  ) throw new TypeError("Canvas migration author differs from the resolved current authority")
}

function assertValidatedCanvasAuthority(
  identity: ValidatedCanvasGenesisIdentity,
  expected: ImmediatePredecessorCurrentAuthorityBinding,
): void {
  if (
    identity.authorAuthorityKind !== expected.mode ||
    identity.authorReplicaId !== expected.replicaId ||
    identity.authorActorId !== expected.actorId ||
    identity.authorAuthorizationDigest !== expected.authorizationDigest ||
    identity.authorAuthorityDigest !== expected.authorityDigest
  ) throw new TypeError("Verified Canvas genesis differs from the resolved current authority")
}

function currentValidationArtifactSetDigest(authority: CurrentProtocolAuthority): Digest {
  const ownerByName = new Map([
    ["canvas-schema", "canvas"],
    ["collaboration-kernel", "kernel"],
    ["control-plane", "control-plane"],
    ["project-persistence", "project-index"],
  ] as const)
  return structuredDigest("convax.validation-artifact-set", {
    format: "convax.validation-artifact-set",
    artifacts: authority.protocolSchemaBundle.core.artifacts.map((artifact) => Object.freeze({
      owner: ownerByName.get(artifact.name),
      format: artifact.format,
      artifactDigest: artifact.artifactDigest,
    })).sort((left, right) => String(left.owner).localeCompare(String(right.owner))),
  })
}

function selectedCanvasSchemaDigest(authority: CurrentProtocolAuthority): Digest {
  const selected = authority.protocolSchemaBundle.core.artifacts.find((artifact) => artifact.name === "canvas-schema")
  if (!selected) throw new TypeError("Current protocol lacks its Canvas schema artifact")
  return parseDigest(selected.artifactDigest)
}

export interface CreateImmediatePredecessorProjectMigrationPortOptions {
  readonly authority: ImmediatePredecessorProjectMigrationAuthorityPort
  readonly currentStore: ImmediatePredecessorCurrentStorePort
  readonly runtime: ImmediatePredecessorProjectMigrationRuntimePort
}

export interface ImmediatePredecessorProjectMigrationRuntimePort {
  /** Quiesces every local Project writer/session for the complete migration. */
  runClosed<Result>(input: Readonly<{
    projectId: string
    projectRoot: string
    operation(): Promise<Result>
  }>): Promise<Result>
}

/**
 * Creates the Project-owned idempotent/single-flight open gate. Only the sealed
 * immediate predecessor can reach the local-owner cutover; Team, unknown and
 * corrupt data remain untouched and surface as unsupported recovery data.
 */
export function createImmediatePredecessorProjectMigrationPort(
  options: CreateImmediatePredecessorProjectMigrationPortOptions,
): ImmediatePredecessorProjectMigrationPort {
  const flights = new Map<string, Promise<Readonly<{ status: "current" | "migrated" }>>>()
  const knownCurrent = new Set<string>()
  return Object.freeze({
    ensureCurrent(input: { readonly projectId: string; readonly projectRoot: string }) {
      const projectId = parseProjectId(input.projectId)
      if (!path.isAbsolute(input.projectRoot) || path.resolve(input.projectRoot) !== input.projectRoot) {
        return Promise.reject(new TypeError("Project migration root must be canonical and absolute"))
      }
      const key = `${projectId}\0${input.projectRoot}`
      if (knownCurrent.has(key)) return Promise.resolve(Object.freeze({ status: "current" as const }))
      const existing = flights.get(key)
      if (existing) return existing
      const flight = options.runtime.runClosed({
        projectId,
        projectRoot: input.projectRoot,
        operation: () => ensureCurrentOnce(options, { projectId, projectRoot: input.projectRoot }),
      }).then((result) => {
        knownCurrent.add(key)
        return result
      })
        .finally(() => flights.delete(key))
      flights.set(key, flight)
      return flight
    },
  })
}

async function ensureCurrentOnce(
  options: CreateImmediatePredecessorProjectMigrationPortOptions,
  input: Readonly<{ projectId: ReturnType<typeof parseProjectId>; projectRoot: string }>,
): Promise<Readonly<{ status: "current" | "migrated" }>> {
  const projectRoot = await fs.realpath(input.projectRoot)
  if (projectRoot !== input.projectRoot) throw new TypeError("Project migration root binding changed")
  const collaborationDirectory = path.join(projectRoot, ".convax", "collaboration")
  if (await isExactCollaborationAbsence(projectRoot, collaborationDirectory)) {
    return Object.freeze({ status: "current" as const })
  }
  await recoverImmediatePredecessorCollaborationCutover({
    projectRoot,
    collaborationDirectory,
    verifyCurrentStore: (directory, expectedSourceClosureDigest, expectedCurrentAuthority) => options.currentStore.verifyCurrentStore({
      projectId: input.projectId,
      collaborationDirectory: directory,
      migrationImportBaseProofDigest: parseDigest(expectedSourceClosureDigest),
      expectedAuthority: parseMarkerCurrentAuthority(expectedCurrentAuthority),
    }),
    inspectImmediatePredecessor: (directory) => inspectRecoveryPredecessorClosureDigest({
      projectId: input.projectId,
      projectRoot,
      collaborationDirectory: directory,
      authority: options.authority,
      currentStore: options.currentStore,
    }),
  })
  try {
    const current = await readProjectNativeStoreManifest(
      collaborationDirectory,
      options.currentStore.authority,
    )
    if (current.projectIndexScope.projectId !== input.projectId) {
      throw new TypeError("Current Project manifest crossed the registered Project")
    }
    return Object.freeze({ status: "current" as const })
  } catch {
    // Exact predecessor decoding below is the only fallback. Its exact manifest
    // identity prevents corrupt/unknown current bytes from selecting migration.
  }

  let predecessorManifest: ImmediatePredecessorProjectNativeStoreManifest
  try {
    predecessorManifest = await readImmediatePredecessorProjectNativeStoreManifest(collaborationDirectory)
  } catch {
    throw new UnsupportedProjectDataError([".convax/collaboration"])
  }
  if (predecessorManifest.projectIndexScope.projectId !== input.projectId) {
    throw new UnsupportedProjectDataError([".convax/collaboration/manifest-v2.bin"])
  }
  const predecessor = await options.authority.inspectPredecessor({
    projectId: input.projectId,
    projectRoot,
    predecessorManifest,
  })
  if (predecessor.status !== "verified") {
    throw new UnsupportedProjectDataError([".convax/collaboration"])
  }

  let inspected: InspectedMigrationSource
  try {
    inspected = await inspectMigrationSource({
      collaborationDirectory,
      manifest: predecessorManifest,
      predecessor,
      currentStore: options.currentStore,
    })
  } catch {
    throw new UnsupportedProjectDataError([".convax/collaboration"])
  }
  try {
    const current = await options.authority.prepareCurrent({
      projectId: input.projectId,
      projectRoot,
      predecessorManifest,
      sourceClosureDigest: inspected.sourceClosureDigest,
      predecessor,
    })
    if (current.status !== "authorized" || current.mode !== predecessor.mode) {
      throw new UnsupportedProjectDataError([".convax/collaboration"])
    }
    const expectedAuthority = currentAuthorityBinding(current)
    const prepared = await materializeMigrationPlan({
      inspected,
      current,
      currentStore: options.currentStore,
    })
    try {
    await migrateImmediatePredecessorCollaborationStore({
      projectRoot,
      collaborationDirectory,
      inspectImmediatePredecessor: (directory) => inspectImmediatePredecessorClosureDigest({
        collaborationDirectory: directory,
        predecessor,
        currentStore: options.currentStore,
      }),
      expectedSourceClosureDigest: prepared.sourceClosureDigest,
      expectedCurrentAuthority: expectedAuthority,
      buildCurrentStore: async (stageDirectory) => {
        await initializeImmediatePredecessorImportedProjectIndexNativeStoreInPlace({
          collaborationDirectory: stageDirectory,
          localActorId: current.actorId,
          materializer: options.currentStore.materializer,
          genesis: prepared.projectIndexGenesis,
        })
        const persistence = await NodeCollaborationPersistence.open({
          collaborationDirectory: stageDirectory,
          localActorId: current.actorId,
          materializer: options.currentStore.materializer,
        })
        try {
          for (const canvas of prepared.canvasGenesis) {
            await persistence.initializeShardWithGenesisProof(canvas)
          }
        } finally {
          persistence.dispose()
        }
      },
      verifyCurrentStore: (directory, expectedSourceClosureDigest, markerAuthority) => options.currentStore.verifyCurrentStore({
        projectId: inputProjectId(predecessorManifest),
        collaborationDirectory: directory,
        migrationImportBaseProofDigest: parseDigest(expectedSourceClosureDigest),
        expectedAuthority: assertSameCurrentAuthority(expectedAuthority, markerAuthority),
      }),
    })
    return Object.freeze({ status: "migrated" as const })
    } finally {
      prepared.dispose()
    }
  } finally {
    inspected.dispose()
  }
}

interface InspectedMigrationSource {
  readonly manifest: ImmediatePredecessorProjectNativeStoreManifest
  readonly projectIndexDocument: Y.Doc
  readonly predecessorCanvases: readonly Readonly<{
    scope: DocumentScope & { readonly docKind: "canvas" }
    document: Y.Doc
  }>[]
  readonly sourceClosureDigest: Digest
  dispose(): void
}

async function inspectMigrationSource(input: Readonly<{
  collaborationDirectory: string
  manifest: ImmediatePredecessorProjectNativeStoreManifest
  predecessor: Extract<ImmediatePredecessorProjectMigrationPredecessorInspection, { status: "verified" }>
  currentStore: ImmediatePredecessorCurrentStorePort
}>): Promise<InspectedMigrationSource> {
  const documents: Y.Doc[] = []
  const reader = await openImmediatePredecessorCollaborationStoreReadOnly({
    collaborationDirectory: input.collaborationDirectory,
    localActorId: parseActorId(input.predecessor.predecessorLocalActorId),
    signatures: input.predecessor.predecessorSignatures,
    owner: {
      createDocument(scope) {
        if (scope.docKind === "project-index") return createProjectIndexReconstructionYDoc()
        if (scope.docKind === "canvas") return createCanvasReconstructionYDoc()
        throw new TypeError("Immediate-predecessor inventory contains an unknown document owner")
      },
      canonicalStateDigest(document, scope) {
        if (scope.docKind === "project-index") {
          return immediatePredecessorProjectIndexCanonicalStateDigest({
            predecessorDocument: document,
            predecessorScope: scope,
            currentProtocolDigest: input.currentStore.authority.protocolDigest,
            currentUriProtocolDigest: input.currentStore.authority.uriProtocolDigest,
            checkpointAuthorReplicaId: input.predecessor.predecessorReplicaId,
          })
        }
        if (scope.docKind === "canvas") {
          return immediatePredecessorCanvasCanonicalStateDigest({
            predecessorDocument: document,
            predecessorScope: scope,
            currentOwnerSchemaDigest: input.currentStore.authority.canvasSchemaDigest,
            currentProtocolDigest: input.currentStore.authority.protocolDigest,
            checkpointAuthorReplicaId: input.predecessor.predecessorReplicaId,
          })
        }
        throw new TypeError("Immediate-predecessor inventory contains an unknown document owner")
      },
    },
  })
  try {
    const projectIndexHead = await reader.loadReplicaHead(input.manifest.projectIndexScope)
    const projectIndexDocument = reconstructProjectIndex(projectIndexHead.fullUpdate)
    documents.push(projectIndexDocument)
    const canvasInventory = inspectImmediatePredecessorProjectIndexCanvasInventory({
      predecessorDocument: projectIndexDocument,
      predecessorScope: input.manifest.projectIndexScope,
      currentProtocolDigest: input.currentStore.authority.protocolDigest,
      currentUriProtocolDigest: input.currentStore.authority.uriProtocolDigest,
      checkpointAuthorReplicaId: input.predecessor.predecessorReplicaId,
    })
    const inventory = await reader.listDocumentScopes()
    assertMigrationScopeInventory(
      inventory,
      input.manifest.projectIndexScope,
      canvasInventory.liveScopes,
      canvasInventory.historicalScopes,
    )
    const heads = [projectIndexHead]
    const liveScopeKeys = new Set(canvasInventory.liveScopes.map(scopeKey))
    const predecessorCanvases: Array<Readonly<{ scope: DocumentScope & { docKind: "canvas" }; document: Y.Doc }>> = []
    for (const scope of inventory
      .filter((scope): scope is DocumentScope & { docKind: "canvas" } => scope.docKind === "canvas")
      .sort((left, right) => scopeKey(left).localeCompare(scopeKey(right)))) {
      const head = await reader.loadReplicaHead(scope)
      heads.push(head)
      const document = createCanvasReconstructionYDoc()
      applyYjsUpdate(document, head.fullUpdate, Object.freeze({ format: "convax.immediate-predecessor-canvas-import" }))
      documents.push(document)
      if (liveScopeKeys.has(scopeKey(scope))) predecessorCanvases.push(Object.freeze({ scope, document }))
    }
    const sourceClosureDigest = deriveImmediatePredecessorClosureDigest(input.manifest, heads)
    return Object.freeze({
      manifest: input.manifest,
      projectIndexDocument,
      predecessorCanvases: Object.freeze(predecessorCanvases),
      sourceClosureDigest,
      dispose() {
        reader.dispose()
        for (const document of documents) document.destroy()
      },
    })
  } catch (error) {
    reader.dispose()
    for (const document of documents) document.destroy()
    throw error
  }
}

async function materializeMigrationPlan(input: Readonly<{
  inspected: InspectedMigrationSource
  current: Extract<ImmediatePredecessorProjectMigrationCurrentAuthority, { status: "authorized" }>
  currentStore: ImmediatePredecessorCurrentStorePort
}>): Promise<Readonly<{
  projectIndexGenesis: VerifiedImmediatePredecessorImportedProjectIndexGenesis
  canvasGenesis: readonly InitializeNativeCollaborationShardWithGenesisProof[]
  sourceClosureDigest: Digest
  dispose(): void
}>> {
  const documents: Y.Doc[] = []
  try {
    const migrationImportBaseProofDigest = input.inspected.sourceClosureDigest
    const expectedAuthority = currentAuthorityBinding(input.current)
    const canvasGenesis: InitializeNativeCollaborationShardWithGenesisProof[] = []
    const canvasBindings = new Map<string, { checkpointObjectDigest: Digest; fullUpdateDigest: Digest; stateVectorDigest: Digest }>()
    for (const predecessor of input.inspected.predecessorCanvases) {
      const rebuilt = rebuildImmediatePredecessorCanvasDocument({
        predecessorDocument: predecessor.document,
        predecessorScope: predecessor.scope,
        currentScope: predecessor.scope,
        currentOwnerSchemaDigest: input.currentStore.authority.canvasSchemaDigest,
        currentProtocolDigest: input.currentStore.authority.protocolDigest,
        currentProjectIndexRouteDependencyDigest: migrationImportBaseProofDigest,
        checkpointAuthorReplicaId: input.current.replicaId,
      })
      documents.push(rebuilt.currentDocument)
      validateCanvasYDoc(rebuilt.currentDocument, predecessor.scope)
      const built = await input.currentStore.buildCanvasGenesis({
        scope: predecessor.scope,
        document: rebuilt.currentDocument,
        migrationImportBaseProofDigest,
        expectedAuthority,
      })
      const genesis = built.genesis
      if (genesis.scope.docKind !== "canvas" || genesis.scope.docId !== predecessor.scope.docId) {
        throw new TypeError("Migrated Canvas genesis crossed its predecessor scope")
      }
      if (
        built.projectIndexRouteDependency.kind !== "migration-import-base" ||
        built.projectIndexRouteDependency.digest !== migrationImportBaseProofDigest
      ) throw new TypeError("Migrated Canvas genesis does not bind the import-base proof")
      canvasGenesis.push(genesis)
      canvasBindings.set(predecessor.scope.docId, Object.freeze({
        checkpointObjectDigest: genesis.checkpointObjectDigest,
        fullUpdateDigest: yjsUpdateDigest(genesis.acceptedBase.fullUpdate),
        stateVectorDigest: stateVectorDigest(genesis.acceptedBase.stateVector),
      }))
    }
    const rebuiltProjectIndex = rebuildImmediatePredecessorProjectIndexDocument({
      predecessorDocument: input.inspected.projectIndexDocument,
      predecessorScope: input.inspected.manifest.projectIndexScope,
      currentScope: input.inspected.manifest.projectIndexScope,
      currentProtocolDigest: input.currentStore.authority.protocolDigest,
      currentUriProtocolDigest: input.currentStore.authority.uriProtocolDigest,
      checkpointAuthorReplicaId: input.current.replicaId,
      migrationActorId: input.current.actorId,
      migrationOperationId: input.current.migrationOperationId,
      migrationImportBaseProofDigest,
      canvasGenesisByCanvasId: canvasBindings,
    })
    documents.push(rebuiltProjectIndex.currentDocument)
    validateProjectIndexYDoc(rebuiltProjectIndex.currentDocument, input.inspected.manifest.projectIndexScope)
    const projectIndexGenesis = await input.currentStore.buildProjectIndexGenesis({
      scope: input.inspected.manifest.projectIndexScope,
      document: rebuiltProjectIndex.currentDocument,
      migrationImportBaseProofDigest,
      expectedAuthority,
    })
    if (
      projectIndexGenesis.manifest.projectIndexGenesisKind !== "immediate-predecessor-import" ||
      projectIndexGenesis.manifest.migrationImportBaseProofDigest !== migrationImportBaseProofDigest
    ) throw new TypeError("Migrated ProjectIndex genesis does not bind the import-base proof")
    return Object.freeze({
      projectIndexGenesis,
      canvasGenesis: Object.freeze(canvasGenesis),
      sourceClosureDigest: input.inspected.sourceClosureDigest,
      dispose() {
        for (const document of documents) document.destroy()
      },
    })
  } catch (error) {
    for (const document of documents) document.destroy()
    throw error
  }
}

function reconstructProjectIndex(fullUpdate: Readonly<Uint8Array>): Y.Doc {
  const document = createProjectIndexReconstructionYDoc()
  applyYjsUpdate(document, fullUpdate, Object.freeze({ format: "convax.immediate-predecessor-project-index-import" }))
  return document
}

function migrationManifestProof(manifest: ImmediatePredecessorProjectNativeStoreManifest): Digest {
  return structuredDigest("convax.immediate-predecessor-project-manifest-proof/1", manifest)
}

async function inspectImmediatePredecessorClosureDigest(input: Readonly<{
  collaborationDirectory: string
  predecessor: Extract<ImmediatePredecessorProjectMigrationPredecessorInspection, { status: "verified" }>
  currentStore: ImmediatePredecessorCurrentStorePort
}>): Promise<Digest> {
  const manifest = await readImmediatePredecessorProjectNativeStoreManifest(input.collaborationDirectory)
  const reader = await openImmediatePredecessorCollaborationStoreReadOnly({
    collaborationDirectory: input.collaborationDirectory,
    localActorId: input.predecessor.predecessorLocalActorId,
    signatures: input.predecessor.predecessorSignatures,
    owner: immediatePredecessorOwnerProjection(input.currentStore, input.predecessor.predecessorReplicaId),
  })
  try {
    const scopes = await reader.listDocumentScopes()
    const heads = []
    for (const scope of [...scopes].sort((left, right) => scopeKey(left).localeCompare(scopeKey(right)))) {
      heads.push(await reader.loadReplicaHead(scope))
    }
    return deriveImmediatePredecessorClosureDigest(manifest, heads)
  } finally {
    reader.dispose()
  }
}

async function inspectRecoveryPredecessorClosureDigest(input: Readonly<{
  projectId: ReturnType<typeof parseProjectId>
  projectRoot: string
  collaborationDirectory: string
  authority: ImmediatePredecessorProjectMigrationAuthorityPort
  currentStore: ImmediatePredecessorCurrentStorePort
}>): Promise<Digest> {
  const predecessorManifest = await readImmediatePredecessorProjectNativeStoreManifest(input.collaborationDirectory)
  if (predecessorManifest.projectIndexScope.projectId !== input.projectId) {
    throw new TypeError("Migration rollback crossed its registered Project")
  }
  const predecessor = await input.authority.inspectPredecessor({
    projectId: input.projectId,
    projectRoot: input.projectRoot,
    predecessorManifest,
  })
  if (predecessor.status !== "verified") {
    throw new TypeError("Migration rollback authority is unavailable")
  }
  return inspectImmediatePredecessorClosureDigest({
    collaborationDirectory: input.collaborationDirectory,
    predecessor,
    currentStore: input.currentStore,
  })
}

function currentAuthorityBinding(
  current: Extract<ImmediatePredecessorProjectMigrationCurrentAuthority, { status: "authorized" }>,
): ImmediatePredecessorCurrentAuthorityBinding {
  return Object.freeze({
    mode: current.mode,
    actorId: parseActorId(current.actorId),
    memberId: parseMemberId(current.memberId),
    replicaId: parseReplicaId(current.replicaId),
    authorizationDigest: parseDigest(current.authorizationDigest),
    authorityDigest: parseDigest(current.authorityDigest),
  })
}

function parseMarkerCurrentAuthority(
  value: MigrationCurrentAuthorityIdentity,
): ImmediatePredecessorCurrentAuthorityBinding {
  return Object.freeze({
    mode: value.mode,
    actorId: parseActorId(value.actorId),
    memberId: parseMemberId(value.memberId),
    replicaId: parseReplicaId(value.replicaId),
    authorizationDigest: parseDigest(value.authorizationDigest),
    authorityDigest: parseDigest(value.authorityDigest),
  })
}

function assertSameCurrentAuthority(
  expected: ImmediatePredecessorCurrentAuthorityBinding,
  marker: MigrationCurrentAuthorityIdentity,
): ImmediatePredecessorCurrentAuthorityBinding {
  const parsed = parseMarkerCurrentAuthority(marker)
  if (
    parsed.mode !== expected.mode || parsed.actorId !== expected.actorId ||
    parsed.memberId !== expected.memberId || parsed.replicaId !== expected.replicaId ||
    parsed.authorizationDigest !== expected.authorizationDigest ||
    parsed.authorityDigest !== expected.authorityDigest
  ) throw new TypeError("Migration marker current authority differs from the prepared signer")
  return parsed
}

function immediatePredecessorOwnerProjection(
  currentStore: ImmediatePredecessorCurrentStorePort,
  checkpointAuthorReplicaId: ReplicaId,
) {
  return Object.freeze({
    createDocument(scope: DocumentScope) {
      if (scope.docKind === "project-index") return createProjectIndexReconstructionYDoc()
      if (scope.docKind === "canvas") return createCanvasReconstructionYDoc()
      throw new TypeError("Immediate-predecessor inventory contains an unknown document owner")
    },
    canonicalStateDigest(document: Y.Doc, scope: DocumentScope) {
      if (scope.docKind === "project-index") {
        return immediatePredecessorProjectIndexCanonicalStateDigest({
          predecessorDocument: document,
          predecessorScope: scope,
          currentProtocolDigest: currentStore.authority.protocolDigest,
          currentUriProtocolDigest: currentStore.authority.uriProtocolDigest,
          checkpointAuthorReplicaId,
        })
      }
      if (scope.docKind === "canvas") {
        return immediatePredecessorCanvasCanonicalStateDigest({
          predecessorDocument: document,
          predecessorScope: scope,
          currentOwnerSchemaDigest: currentStore.authority.canvasSchemaDigest,
          currentProtocolDigest: currentStore.authority.protocolDigest,
          checkpointAuthorReplicaId,
        })
      }
      throw new TypeError("Immediate-predecessor inventory contains an unknown document owner")
    },
  })
}

function deriveImmediatePredecessorClosureDigest(
  manifest: ImmediatePredecessorProjectNativeStoreManifest,
  heads: readonly Readonly<{
    scope: DocumentScope
    headDigest: Digest
    frontierDigest: Digest
    canonicalStateDigest: Digest
    materializationDigest: Digest
  }>[],
): Digest {
  return structuredDigest(
    "convax.immediate-predecessor-project-import-base-proof/1",
    Object.freeze({
      format: "convax.immediate-predecessor-project-import-base-proof/1",
      manifestProof: migrationManifestProof(manifest),
      documents: heads.map((head) => Object.freeze({
        scope: head.scope,
        headDigest: head.headDigest,
        frontierDigest: head.frontierDigest,
        canonicalStateDigest: head.canonicalStateDigest,
        materializationDigest: head.materializationDigest,
      })).sort((left, right) => scopeKey(left.scope).localeCompare(scopeKey(right.scope))),
    }),
  )
}

function inputProjectId(manifest: ImmediatePredecessorProjectNativeStoreManifest): string {
  return manifest.projectIndexScope.projectId
}

function assertMigrationScopeInventory(
  actualInput: readonly DocumentScope[],
  projectIndexScope: DocumentScope,
  liveCanvasScopes: readonly DocumentScope[],
  historicalCanvasScopes: readonly DocumentScope[],
): void {
  const actual = actualInput.map(parseDocumentScope)
  const actualKeys = new Set(actual.map(scopeKey))
  if (actualKeys.size !== actual.length || !actualKeys.has(scopeKey(projectIndexScope))) {
    throw new TypeError("Immediate-predecessor document inventory has duplicate or missing ProjectIndex scope")
  }
  for (const scope of actual) {
    if (
      scope.projectId !== projectIndexScope.projectId ||
      scope.projectEpoch !== projectIndexScope.projectEpoch ||
      (scope.docKind === "project-index" && scopeKey(scope) !== scopeKey(projectIndexScope))
    ) throw new TypeError("Immediate-predecessor document inventory crosses its ProjectIndex identity")
  }
  for (const scope of liveCanvasScopes) {
    if (!actualKeys.has(scopeKey(scope))) {
      throw new TypeError("Immediate-predecessor document inventory is missing a live Canvas route")
    }
  }
  const historicalKeys = new Set(historicalCanvasScopes.map(scopeKey))
  for (const scope of actual) {
    if (scope.docKind === "canvas" && !historicalKeys.has(scopeKey(scope))) {
      throw new TypeError("Immediate-predecessor document inventory contains a signed but never-routed Canvas shard")
    }
  }
}

function scopeKey(scope: DocumentScope): string {
  return `${scope.projectId}\0${scope.projectEpoch}\0${scope.docKind}\0${scope.docId}\0${scope.shardEpoch}`
}

async function isExactCollaborationAbsence(projectRoot: string, collaborationDirectory: string): Promise<boolean> {
  const collaboration = await fs.lstat(collaborationDirectory).catch((error) => {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null
    throw error
  })
  if (collaboration !== null) return false
  const privateRoot = path.join(projectRoot, ".convax")
  const entries = await fs.readdir(privateRoot).catch((error) => {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [] as string[]
    throw error
  })
  return !entries.some((name) =>
    name === "collaboration-migration.json" ||
    name === "collaboration-migration.lock" ||
    name === "collaboration.staging" ||
    name.startsWith("collaboration-migration-stage-") ||
    name.startsWith("collaboration-migration-rollback-"),
  )
}
