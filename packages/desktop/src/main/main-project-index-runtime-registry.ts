import path from "node:path"
import {
  encodeRestrictedJcs,
  parseDigest,
  parseProjectId,
  replicaActorHeadSetDigest,
  replicaCheckpointCoreDigest,
  type CollaborationKernelOptions,
  type DecodedCausalEditFrame,
  type Digest,
  type DocumentOwnerRuntime,
  type DocumentScope,
  type Id128,
  type IncomingOwnerFactResolverPort,
  type ProjectId,
  type CurrentProtocolAuthority,
  type YjsDocumentFactory,
} from "@convax/collaboration"
import {
  ProjectIndexCanvasApplication,
  ProjectIndexFileApplication,
  type ProjectCanvasGenesisStagingPort,
  type ProjectIndexCanvasApplicationPort,
  type ProjectIndexFactResolutionPort,
  type ProjectIndexFileApplicationPort,
  type ProjectIndexFileMaterializationProjectionPort,
} from "@convax/project/canvas"
import {
  PROJECT_INDEX_PROTOCOL_SCHEMA_ARTIFACT_DIGEST,
  createProjectIndexDocumentOwnerRuntime,
  type ProjectBlobAvailabilityQueryPort,
  type ProjectIndexCurrentBlobReferencePort,
  type ProjectIndexCurrentResourceReferenceQueryPort,
} from "@convax/project"
import type {
  NodeProjectCollaborationRuntimeCoordinator,
  ProjectCollaborationRuntimeLease,
} from "@convax/project/node"
import {
  createEmptyProjectIndexGenesisCandidate,
  initializeUnteamedProjectIndexNativeStore,
  resolvePortableProjectData,
  ProjectBlobReplicationStore,
  ProjectIndexFileMaterializer,
  readProjectNativeStoreManifest,
  verifyEmptyProjectIndexGenesis,
  verifyPristineUnteamedProjectIndexNativeStore,
  type NodeReplicaHeadMaterializer,
  type RegisteredProjectPrivateStorageRecoveryPort,
} from "@convax/project/node"

import {
  createMainCollaborationLatencyDiagnosticsPort,
  createKernelBackedMainCollaborationDocumentSession,
  type MainCollaborationDocumentSession,
} from "./collaboration-document-session"
import {
  createMainCollaborationProductionRuntime,
  type MainCollaborationProductionRuntime,
  type ProjectCollaborationMaterializerRegistry,
} from "./collaboration-production-runtime"
import type {
  CurrentLocalReplicaAuthoritySource,
  IncomingReplicaAuthoritySource,
} from "./collaboration-authority-ports"
import type {
  DurableLocalProjectOwnerAuthorityResolver,
  NodeDurableLocalProjectOwnerAuthority,
  ResolvedLocalProjectOwnerAuthority,
} from "./local-project-owner-authority"

type ProjectIndexScope = DocumentScope & {
  readonly docKind: "project-index"
  readonly docId: "project-index"
}

export interface MainProjectIndexFirstRegistrationPort {
  /**
   * Completes or verifies the exact manifest-bound ProjectIndex genesis before
   * the coordinator is allowed to create/open the Project writer.
   */
  ensureRegistered(input: {
    readonly projectId: ReturnType<typeof parseProjectId>
    readonly projectRoot: string
  }): Promise<ProjectIndexScope>
}

export class CollaborationEnrollmentRequiredError extends Error {
  readonly code = "collaboration-enrollment-required" as const

  constructor(
    readonly projectId: string,
    options?: ErrorOptions,
  ) {
    super(`Project collaboration enrollment is required: ${projectId}`, options)
    this.name = "CollaborationEnrollmentRequiredError"
  }
}

/** Existing verified stores open offline; absent stores never mint local authority. */
export function createExistingProjectIndexRegistrationPort(
  authority: CurrentProtocolAuthority,
): MainProjectIndexFirstRegistrationPort {
  const port: MainProjectIndexFirstRegistrationPort = {
    async ensureRegistered({ projectId, projectRoot }) {
      try {
        const manifest = await readProjectNativeStoreManifest(path.join(projectRoot, ".convax", "collaboration"), {
          protocolDigest: authority.protocolDigest,
          schemaDigest: PROJECT_INDEX_PROTOCOL_SCHEMA_ARTIFACT_DIGEST,
          uriProtocolDigest: authority.protocolSchemaBundle.core.uriProtocolDigest,
        })
        if (manifest.projectIndexScope.projectId !== projectId) {
          throw new Error("ProjectIndex manifest crossed the bound Project")
        }
        return manifest.projectIndexScope
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          throw new CollaborationEnrollmentRequiredError(projectId, { cause: error })
        }
        throw error
      }
    },
  }
  return Object.freeze(port)
}

/**
 * First registration for a durable unteamed Project. The Project binding and
 * user-managed private key file are committed before these bytes are constructed;
 * retries sign the same checkpoint core and native-store publication rejects
 * equivocation.
 */
export function createLocalProjectOwnerIndexRegistrationPort(
  authority: CurrentProtocolAuthority,
  owners: DurableLocalProjectOwnerAuthorityResolver &
    Pick<NodeDurableLocalProjectOwnerAuthority, "verifyCheckpointSignature">,
  projects: RegisteredProjectPrivateStorageRecoveryPort,
): MainProjectIndexFirstRegistrationPort {
  const port: MainProjectIndexFirstRegistrationPort = {
    async ensureRegistered({ projectId, projectRoot }) {
      const resolution = await resolvePortableProjectData(projectRoot)
      if (resolution.status === "unsupported-project-data") throw resolution.error
      if (resolution.status === "recovery-required") {
        throw new Error("Project collaboration reset recovery must finish before first registration")
      }
      await projects.ensureRegisteredProjectPrivateStorage({ projectId, projectRoot })
      const authorityTuple = {
        protocolDigest: authority.protocolDigest,
        schemaDigest: PROJECT_INDEX_PROTOCOL_SCHEMA_ARTIFACT_DIGEST,
        uriProtocolDigest: authority.protocolSchemaBundle.core.uriProtocolDigest,
      } as const
      const collaborationDirectory = path.join(projectRoot, ".convax", "collaboration")
      try {
        const manifest = await readProjectNativeStoreManifest(collaborationDirectory, authorityTuple)
        if (manifest.projectIndexScope.projectId !== projectId) {
          throw new Error("ProjectIndex manifest crossed the bound Project")
        }
        return manifest.projectIndexScope
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
      }

      const owner = await owners.ensureForDurableProject({ projectId, projectRoot })
      return initializeLocalOwnerProjectIndexNativeStore({
        authority,
        collaborationDirectory,
        owner,
        verifyCheckpointSignature: (binding, coreDigest, signature) =>
          owners.verifyCheckpointSignature(binding, coreDigest, signature),
      })
    },
  }
  return Object.freeze(port)
}

export async function initializeLocalOwnerProjectIndexNativeStore(input: {
  readonly authority: CurrentProtocolAuthority
  readonly collaborationDirectory: string
  readonly owner: ResolvedLocalProjectOwnerAuthority
  readonly verifyCheckpointSignature: NodeDurableLocalProjectOwnerAuthority["verifyCheckpointSignature"]
}): Promise<ProjectIndexScope> {
  const { authority, owner, collaborationDirectory } = input
  const prepared = await prepareLocalOwnerProjectIndexGenesis(input)
  const authorityTuple = {
    protocolDigest: authority.protocolDigest,
    schemaDigest: PROJECT_INDEX_PROTOCOL_SCHEMA_ARTIFACT_DIGEST,
    uriProtocolDigest: authority.protocolSchemaBundle.core.uriProtocolDigest,
  } as const
  const { genesis, scope } = prepared
  await initializeUnteamedProjectIndexNativeStore({
    collaborationDirectory,
    localActorId: owner.binding.actorId,
    materializer: genesisMaterializer,
    genesis,
  })
  const installed = await readProjectNativeStoreManifest(collaborationDirectory, authorityTuple)
  if (
    installed.projectIndexScope.projectId !== scope.projectId ||
    installed.initializationAuthorityDigest !== owner.binding.bindingDigest
  )
    throw new Error("Installed ProjectIndex genesis crossed local owner authority")
  return installed.projectIndexScope
}

export async function verifyPristineLocalOwnerProjectIndexNativeStore(input: {
  readonly authority: CurrentProtocolAuthority
  readonly collaborationDirectory: string
  readonly owner: ResolvedLocalProjectOwnerAuthority
  readonly verifyCheckpointSignature: NodeDurableLocalProjectOwnerAuthority["verifyCheckpointSignature"]
}): Promise<void> {
  const manifest = await readProjectNativeStoreManifest(input.collaborationDirectory, {
    protocolDigest: input.authority.protocolDigest,
    schemaDigest: PROJECT_INDEX_PROTOCOL_SCHEMA_ARTIFACT_DIGEST,
    uriProtocolDigest: input.authority.protocolSchemaBundle.core.uriProtocolDigest,
  })
  await verifyPristineUnteamedProjectIndexNativeStore({
    collaborationDirectory: input.collaborationDirectory,
    localActorId: input.owner.binding.actorId,
    materializer: genesisMaterializer,
    manifest,
    verifier: {
      async verify(checkpoint) {
        const core = checkpoint.core
        if (
          core.authorMemberId !== input.owner.binding.memberId ||
          core.authorReplicaId !== input.owner.binding.replicaId ||
          core.authorActorId !== input.owner.binding.actorId ||
          core.authorAuthorizationDigest !== input.owner.binding.bindingDigest ||
          core.validationArtifactSetDigest !== input.owner.binding.validationArtifactSetDigest
        )
          return false
        return input.verifyCheckpointSignature(input.owner.binding, checkpoint.coreDigest, checkpoint.replicaSignature)
      },
    },
  })
}

async function prepareLocalOwnerProjectIndexGenesis(input: {
  readonly authority: CurrentProtocolAuthority
  readonly collaborationDirectory: string
  readonly owner: ResolvedLocalProjectOwnerAuthority
  readonly verifyCheckpointSignature: NodeDurableLocalProjectOwnerAuthority["verifyCheckpointSignature"]
}) {
  const { authority, owner } = input
  const authorityTuple = {
    protocolDigest: authority.protocolDigest,
    schemaDigest: PROJECT_INDEX_PROTOCOL_SCHEMA_ARTIFACT_DIGEST,
    uriProtocolDigest: authority.protocolSchemaBundle.core.uriProtocolDigest,
  } as const
  const scope: ProjectIndexScope = Object.freeze({
    projectId: owner.binding.projectId,
    projectEpoch: owner.binding.projectEpoch,
    docKind: "project-index",
    docId: "project-index",
    shardEpoch: owner.binding.projectIndexShardEpoch,
  })
  const candidate = createEmptyProjectIndexGenesisCandidate({
    scope,
    actorId: owner.binding.actorId,
    operationId: owner.binding.genesisOperationId,
    checkpointId: owner.binding.genesisCheckpointId,
    authorMemberId: owner.binding.memberId,
    authorReplicaId: owner.binding.replicaId,
    authorAuthorizationDigest: owner.binding.bindingDigest,
    validationArtifactSetDigest: owner.binding.validationArtifactSetDigest,
    authority: authorityTuple,
  })
  const coreDigest = replicaCheckpointCoreDigest(candidate.checkpointCore)
  const checkpoint = Object.freeze({
    format: "convax.replica-checkpoint" as const,
    core: candidate.checkpointCore,
    coreDigest,
    replicaSignature: await owner.signer.sign(Buffer.from(coreDigest, "hex")),
  })
  const genesis = await verifyEmptyProjectIndexGenesis({
    scope,
    document: candidate.document,
    checkpointExactBytes: encodeRestrictedJcs(checkpoint),
    initializationAuthorityDigest: owner.binding.bindingDigest,
    verifier: {
      async verify(value) {
        const core = value.core
        if (
          core.authorMemberId !== owner.binding.memberId ||
          core.authorReplicaId !== owner.binding.replicaId ||
          core.authorActorId !== owner.binding.actorId ||
          core.authorAuthorizationDigest !== owner.binding.bindingDigest ||
          core.validationArtifactSetDigest !== owner.binding.validationArtifactSetDigest
        )
          return false
        return input.verifyCheckpointSignature(owner.binding, value.coreDigest, value.replicaSignature)
      },
    },
  })
  return Object.freeze({ genesis, scope })
}

const genesisMaterializer: NodeReplicaHeadMaterializer = Object.freeze({
  async inspectFrame() {
    throw new Error("ProjectIndex genesis has no causal frame")
  },
  async applyAcceptedFrame() {
    throw new Error("ProjectIndex genesis has no causal frame")
  },
  actorHeadsDigest: replicaActorHeadSetDigest,
})

export interface MainProjectIndexDescriptor {
  readonly createDocument: YjsDocumentFactory["createDocument"]
  readonly incomingFacts: IncomingOwnerFactResolverPort
  readonly requiredBlobDigests: (frame: DecodedCausalEditFrame) => readonly Digest[]
  readonly facts: ProjectIndexFactResolutionPort
  readonly canvasGenesis: ProjectCanvasGenesisStagingPort
}

interface OpenProjectIndexEntry {
  readonly scope: ProjectIndexScope
  readonly project: ProjectCollaborationRuntimeLease
  readonly blobs: ProjectBlobReplicationStore
  readonly runtime: MainCollaborationProductionRuntime<"project-index">
  readonly session: MainCollaborationDocumentSession<"project-index">
  readonly application: ProjectIndexCanvasApplicationPort &
    ProjectIndexCurrentBlobReferencePort &
    ProjectIndexCurrentResourceReferenceQueryPort
  readonly fileApplication: ProjectIndexFileApplicationPort & ProjectIndexFileMaterializationProjectionPort
  readonly disposeFileMaterialization: () => void
}

/**
 * Main-only ProjectIndex owner. It is the sole catalog application registry;
 * neither IPC nor Desktop services cache ProjectIndex JSON/projections.
 */
export class MainProjectIndexRuntimeRegistry
  implements
    ProjectIndexCanvasApplicationPort,
    ProjectBlobAvailabilityQueryPort,
    ProjectIndexCurrentBlobReferencePort,
    ProjectIndexFileApplicationPort,
    ProjectIndexFileMaterializationProjectionPort
{
  private readonly entries = new Map<string, Promise<OpenProjectIndexEntry>>()
  private readonly lanes = new Map<string, Promise<void>>()
  private disposed = false

  constructor(
    private readonly options: {
      readonly authority: CurrentProtocolAuthority
      readonly projects: Pick<NodeProjectCollaborationRuntimeCoordinator, "acquire" | "resolveProjectRoot">
      readonly firstRegistration: MainProjectIndexFirstRegistrationPort
      readonly materializers: ProjectCollaborationMaterializerRegistry
      readonly localAuthority: (project: ProjectCollaborationRuntimeLease) => CurrentLocalReplicaAuthoritySource
      readonly incomingAuthority: IncomingReplicaAuthoritySource
      readonly signatureVerifier: CollaborationKernelOptions["signatureVerifier"]
      readonly createOperationId: () => Id128
      readonly createShardEpoch: () => Id128
      describeProjectIndex(input: {
        readonly scope: ProjectIndexScope
        readonly owner: DocumentOwnerRuntime<"project-index">
        readonly project: ProjectCollaborationRuntimeLease
        readonly blobs: ProjectBlobReplicationStore
      }): MainProjectIndexDescriptor
    },
  ) {}

  async queryCatalog(input: Parameters<ProjectIndexCanvasApplicationPort["queryCatalog"]>[0]) {
    const projectId = parseProjectId(input.projectId)
    return (await this.open(projectId)).application.queryCatalog({ projectId })
  }

  async submitRouteCommand(input: Parameters<ProjectIndexCanvasApplicationPort["submitRouteCommand"]>[0]) {
    const projectId = parseProjectId(input.projectId)
    return (await this.open(projectId)).application.submitRouteCommand({ ...input, projectId })
  }

  async queryCurrentBlobDigests(
    input: Parameters<ProjectIndexCurrentBlobReferencePort["queryCurrentBlobDigests"]>[0],
  ) {
    const projectId = parseProjectId(input.projectId)
    return queryMainProjectIndexCurrentBlobDigests((await this.open(projectId)).application, { projectId })
  }

  async queryCurrentResources(
    input: Parameters<ProjectIndexCurrentBlobReferencePort["queryCurrentResources"]>[0],
  ) {
    const projectId = parseProjectId(input.projectId)
    return (await this.open(projectId)).application.queryCurrentResources({ projectId })
  }

  async queryCurrentResourcesExact(
    input: Parameters<NonNullable<ProjectIndexCurrentBlobReferencePort["queryCurrentResourcesExact"]>>[0],
  ) {
    const projectId = parseProjectId(input.projectId)
    const application = (await this.open(projectId)).application
    if (!application.queryCurrentResourcesExact) {
      throw new Error("ProjectIndex exact current-resource projection is unavailable")
    }
    return application.queryCurrentResourcesExact({ projectId, targets: input.targets })
  }

  async queryCurrentResourceReferences(input: { readonly projectId: ProjectId }) {
    const projectId = parseProjectId(input.projectId)
    return (await this.open(projectId)).application.queryCurrentResourceReferences({ projectId })
  }

  async queryCurrentResourceReferencesExact(
    input: Parameters<NonNullable<ProjectIndexCurrentResourceReferenceQueryPort["queryCurrentResourceReferencesExact"]>>[0],
  ) {
    const projectId = parseProjectId(input.projectId)
    const application = (await this.open(projectId)).application
    if (!application.queryCurrentResourceReferencesExact) {
      throw new Error("ProjectIndex exact current-resource reference query is unavailable")
    }
    return application.queryCurrentResourceReferencesExact({ projectId, targets: input.targets })
  }

  async queryAvailableBlobs(input: Parameters<ProjectBlobAvailabilityQueryPort["queryAvailableBlobs"]>[0]) {
    const projectId = parseProjectId(input.projectId)
    return (await this.open(projectId)).blobs.queryHave(input.blobs)
  }

  async createDirectory(input: Parameters<ProjectIndexFileApplicationPort["createDirectory"]>[0]) {
    const projectId = parseProjectId(input.projectId)
    return (await this.open(projectId)).fileApplication.createDirectory({ ...input, projectId })
  }

  async admitManagedBlob(input: Parameters<ProjectIndexFileApplicationPort["admitManagedBlob"]>[0]) {
    const projectId = parseProjectId(input.projectId)
    return (await this.open(projectId)).fileApplication.admitManagedBlob({ ...input, projectId })
  }

  async publishFile(input: Parameters<ProjectIndexFileApplicationPort["publishFile"]>[0]) {
    const projectId = parseProjectId(input.projectId)
    return (await this.open(projectId)).fileApplication.publishFile({ ...input, projectId })
  }

  async relocateEntry(input: Parameters<ProjectIndexFileApplicationPort["relocateEntry"]>[0]) {
    const projectId = parseProjectId(input.projectId)
    return (await this.open(projectId)).fileApplication.relocateEntry({ ...input, projectId })
  }

  async tombstoneEntry(input: Parameters<ProjectIndexFileApplicationPort["tombstoneEntry"]>[0]) {
    const projectId = parseProjectId(input.projectId)
    return (await this.open(projectId)).fileApplication.tombstoneEntry({ ...input, projectId })
  }

  async queryFileMaterializationPlan(
    input: Parameters<ProjectIndexFileMaterializationProjectionPort["queryFileMaterializationPlan"]>[0],
  ) {
    const projectId = parseProjectId(input.projectId)
    return (await this.open(projectId)).fileApplication.queryFileMaterializationPlan({ projectId })
  }

  async queryFileMaterializationEntries(
    input: Parameters<NonNullable<ProjectIndexFileMaterializationProjectionPort["queryFileMaterializationEntries"]>>[0],
  ) {
    const projectId = parseProjectId(input.projectId)
    const projection = (await this.open(projectId)).fileApplication
    if (!projection.queryFileMaterializationEntries) {
      throw new Error("ProjectIndex exact file materialization projection is unavailable")
    }
    return projection.queryFileMaterializationEntries({
      projectId,
      paths: input.paths,
    })
  }

  async quiesceProject(projectIdInput: string): Promise<void> {
    const projectId = parseProjectId(projectIdInput)
    await this.serialize(projectId, async () => {
      const pending = this.entries.get(projectId)
      if (!pending) return
      this.entries.delete(projectId)
      const entry = await pending.catch(() => undefined)
      if (!entry) return
      try {
        await entry.session.flush()
      } finally {
        entry.disposeFileMaterialization()
        entry.session.dispose()
        entry.runtime.dispose()
        entry.project.release()
      }
    })
  }

  async dispose(): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    await Promise.all([...this.entries.keys()].map((projectId) => this.quiesceProject(projectId)))
  }

  private open(projectId: ReturnType<typeof parseProjectId>): Promise<OpenProjectIndexEntry> {
    this.requireLive()
    let pending = this.entries.get(projectId)
    if (!pending) {
      pending = this.serialize(projectId, async () => {
        this.requireLive()
        const existing = this.entries.get(projectId)
        if (existing) return existing
        const creating = this.openFresh(projectId)
        this.entries.set(projectId, creating)
        void creating.catch(() => {
          if (this.entries.get(projectId) === creating) this.entries.delete(projectId)
        })
        return creating
      }).then((value) => value)
    }
    return pending
  }

  private async openFresh(projectId: ReturnType<typeof parseProjectId>): Promise<OpenProjectIndexEntry> {
    const projectRoot = await this.options.projects.resolveProjectRoot(projectId)
    const registeredScope = await this.options.firstRegistration.ensureRegistered({ projectId, projectRoot })
    if (registeredScope.projectId !== projectId) throw new Error("ProjectIndex first-register crossed Project identity")
    const project = await this.options.projects.acquire(projectId)
    let runtime: MainCollaborationProductionRuntime<"project-index"> | undefined
    let session: MainCollaborationDocumentSession<"project-index"> | undefined
    let disposeFileMaterialization: (() => void) | undefined
    try {
      if (project.projectRoot !== projectRoot)
        throw new Error("Project binding changed during ProjectIndex first-register")
      const owner = createMainProjectIndexOwnerRuntime(this.options.authority)
      const blobs = await ProjectBlobReplicationStore.open({
        collaborationDirectory: project.collaborationDirectory,
        projectId,
        projectEpoch: registeredScope.projectEpoch,
        protocolDigest: this.options.authority.protocolDigest,
      })
      const descriptor = this.options.describeProjectIndex({ scope: registeredScope, owner, project, blobs })
      runtime = await createMainCollaborationProductionRuntime({
        authority: this.options.authority,
        scope: registeredScope,
        owner,
        actorId: project.localActorId,
        localAuthority: this.options.localAuthority(project),
        incomingAuthority: this.options.incomingAuthority,
        incomingFacts: descriptor.incomingFacts,
        createDocument: descriptor.createDocument,
        requiredBlobDigests: descriptor.requiredBlobDigests,
        persistence: project.persistence,
        materializers: this.options.materializers,
      })
      session = await createKernelBackedMainCollaborationDocumentSession({
        authority: this.options.authority,
        scope: registeredScope,
        owner,
        ports: runtime.ports,
        signatureVerifier: this.options.signatureVerifier,
        createOperationId: this.options.createOperationId,
        diagnostics: createMainCollaborationLatencyDiagnosticsPort({
          recordAll: process.env.CONVAX_COLLABORATION_LATENCY_RECORD_ALL === "1",
          // Record-all is a benchmark mode. Avoid letting an O(outbox) sampler
          // contend with the following root and perturb the latency distribution.
          sample: process.env.CONVAX_COLLABORATION_LATENCY_RECORD_ALL === "1"
            ? () => ({})
            : () => runtime!.persistence.sampleLatencyDiagnostics(registeredScope),
        }),
      })
      const application = new ProjectIndexCanvasApplication({
        session,
        facts: descriptor.facts,
        genesis: descriptor.canvasGenesis,
        createOperationId: this.options.createOperationId,
        createShardEpoch: this.options.createShardEpoch,
      })
      const traceBlobPublication = async <T>(byteLength: number, operation: () => Promise<T>): Promise<T> => {
        if (process.env.CONVAX_CANVAS_RESOURCE_LATENCY_RECORD_ALL !== "1") return operation()
        const startedAt = performance.now()
        try {
          return await operation()
        } finally {
          try {
            console.warn("[convax:canvas-resource-latency]", JSON.stringify({
              byteLength,
              callCount: 1,
              durationMs: performance.now() - startedAt,
              stage: "blob-publication",
            }))
          } catch { /* Benchmark diagnostics never affect blob publication. */ }
        }
      }
      const fileApplication = new ProjectIndexFileApplication({
        session,
        facts: descriptor.facts,
        blobs: {
          admitManaged: ({ reference, admission }) =>
            blobs.admitVerifiedStream(reference, admission).then(() => undefined),
          publish: ({ reference, exactBytes }) => traceBlobPublication(exactBytes.byteLength, () =>
            blobs.admitVerifiedBytes(reference, exactBytes).then(() => undefined)),
        },
        createOperationId: this.options.createOperationId,
      })
      const fileMaterializer = await ProjectIndexFileMaterializer.open({
        projectId,
        projectRoot,
        projection: fileApplication,
        blobs,
      })
      const scheduleReconcile = () => {
        void fileMaterializer.reconcile().catch((error: unknown) => {
          console.error(`Failed to reconcile Project files for ${projectId}`, error)
        })
      }
      const unsubscribeSession = session.subscribe(scheduleReconcile)
      const unsubscribeBlobs = blobs.subscribePublished(scheduleReconcile)
      disposeFileMaterialization = () => {
        unsubscribeSession()
        unsubscribeBlobs()
      }
      await fileMaterializer.reconcile()
      return Object.freeze({
        scope: registeredScope,
        project,
        blobs,
        runtime,
        session,
        application,
        fileApplication,
        disposeFileMaterialization,
      })
    } catch (error) {
      disposeFileMaterialization?.()
      session?.dispose()
      runtime?.dispose()
      project.release()
      throw error
    }
  }

  private requireLive(): void {
    if (this.disposed) throw new Error("ProjectIndex runtime registry is disposed")
  }

  private async serialize<T>(projectId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.lanes.get(projectId) ?? Promise.resolve()
    let release!: () => void
    const barrier = new Promise<void>((resolve) => {
      release = resolve
    })
    const lane = previous.catch(() => undefined).then(() => barrier)
    this.lanes.set(projectId, lane)
    await previous.catch(() => undefined)
    try {
      return await operation()
    } finally {
      release()
      if (this.lanes.get(projectId) === lane) this.lanes.delete(projectId)
    }
  }
}

/** Copies and validates the Project-owned projection before native GC consumes it. */
export async function queryMainProjectIndexCurrentBlobDigests(
  application: ProjectIndexCurrentBlobReferencePort,
  input: Parameters<ProjectIndexCurrentBlobReferencePort["queryCurrentBlobDigests"]>[0],
): Promise<ReadonlySet<Digest>> {
  const projectId = parseProjectId(input.projectId)
  const values = await application.queryCurrentBlobDigests({ projectId })
  if (
    !values ||
    typeof values !== "object" ||
    typeof values.size !== "number" ||
    !Number.isSafeInteger(values.size) ||
    values.size < 0 ||
    typeof values.has !== "function" ||
    typeof values[Symbol.iterator] !== "function"
  )
    throw new TypeError("ProjectIndex current blob-reference projection is malformed")
  const result = new Set<Digest>()
  for (const value of values) result.add(parseDigest(value))
  if (result.size !== values.size) {
    throw new TypeError("ProjectIndex current blob-reference projection has inconsistent set semantics")
  }
  return result
}

export function createMainProjectIndexOwnerRuntime(
  authority: CurrentProtocolAuthority,
): DocumentOwnerRuntime<"project-index"> {
  return createProjectIndexDocumentOwnerRuntime(authority)
}
