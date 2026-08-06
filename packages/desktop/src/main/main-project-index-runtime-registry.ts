import path from "node:path"
import {
  createSelectedDocumentOwnerArtifactFactory,
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
  type CurrentProtocolAuthority,
  type YjsDocumentFactory,
} from "@convax/collaboration"
import {
  ProjectIndexCanvasApplicationV2,
  ProjectIndexFileApplicationV2,
  type ProjectCanvasGenesisStagingPortV2,
  type ProjectIndexCanvasApplicationPortV2,
  type ProjectIndexFactResolutionPortV2,
  type ProjectIndexFileApplicationPortV2,
  type ProjectIndexFileMaterializationProjectionPortV2,
} from "@convax/project/canvas"
import {
  PROJECT_INDEX_PROTOCOL_SCHEMA_ARTIFACT_DIGEST_V2,
  selectedProjectIndexDocumentOwnerArtifactDefinitionV2,
  type ProjectIndexCurrentBlobReferencePortV2,
} from "@convax/project"
import type {
  NodeProjectCollaborationRuntimeCoordinatorV2,
  ProjectCollaborationRuntimeLeaseV2,
} from "@convax/project/node"
import {
  createEmptyProjectIndexGenesisCandidate,
  initializeUnteamedProjectIndexNativeStore,
  resolvePortableProjectData,
  ProjectBlobReplicationStoreV2,
  ProjectIndexFileMaterializerV2,
  readProjectNativeStoreManifest,
  verifyEmptyProjectIndexGenesis,
  verifyPristineUnteamedProjectIndexNativeStore,
  type NodeReplicaHeadMaterializerV2,
} from "@convax/project/node"

import {
  createKernelBackedMainCollaborationDocumentSessionV2,
  type MainCollaborationDocumentSessionV2,
} from "./collaboration-document-session"
import {
  createMainCollaborationProductionRuntimeV2,
  type MainCollaborationProductionRuntimeV2,
  type ProjectCollaborationMaterializerRegistryV2,
} from "./collaboration-production-runtime"
import type {
  CurrentLocalReplicaAuthoritySourceV2,
  IncomingReplicaAuthoritySourceV2,
} from "./collaboration-authority-ports"
import type {
  DurableLocalProjectOwnerAuthorityResolverV2,
  NodeDurableLocalProjectOwnerAuthorityV2,
  ResolvedLocalProjectOwnerAuthorityV2,
} from "./local-project-owner-authority"

type ProjectIndexScopeV2 = DocumentScope & {
  readonly docKind: "project-index"
  readonly docId: "project-index"
}

export interface MainProjectIndexFirstRegistrationPortV2 {
  /**
   * Completes or verifies the exact manifest-bound ProjectIndex genesis before
   * the coordinator is allowed to create/open the Project writer.
   */
  ensureRegistered(input: {
    readonly projectId: ReturnType<typeof parseProjectId>
    readonly projectRoot: string
  }): Promise<ProjectIndexScopeV2>
}

export class CollaborationEnrollmentRequiredErrorV2 extends Error {
  readonly code = "collaboration-enrollment-required" as const

  constructor(
    readonly projectId: string,
    options?: ErrorOptions,
  ) {
    super(`Project collaboration enrollment is required: ${projectId}`, options)
    this.name = "CollaborationEnrollmentRequiredErrorV2"
  }
}

/** Existing verified stores open offline; absent stores never mint local authority. */
export function createExistingProjectIndexRegistrationPortV2(
  authority: CurrentProtocolAuthority,
): MainProjectIndexFirstRegistrationPortV2 {
  const port: MainProjectIndexFirstRegistrationPortV2 = {
    async ensureRegistered({ projectId, projectRoot }) {
      try {
        const manifest = await readProjectNativeStoreManifest(path.join(projectRoot, ".convax", "collaboration"), {
          protocolDigest: authority.protocolDigest,
          schemaDigest: PROJECT_INDEX_PROTOCOL_SCHEMA_ARTIFACT_DIGEST_V2,
          uriProtocolDigest: authority.protocolSchemaBundle.core.uriProtocolDigest,
        })
        if (manifest.projectIndexScope.projectId !== projectId) {
          throw new Error("ProjectIndex manifest crossed the bound Project")
        }
        return manifest.projectIndexScope
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          throw new CollaborationEnrollmentRequiredErrorV2(projectId, { cause: error })
        }
        throw error
      }
    },
  }
  return Object.freeze(port)
}

/**
 * First registration for a durable unteamed Project. The Project binding and OS
 * vault key are committed before these bytes are constructed; retries sign the
 * same checkpoint core and native-store publication rejects equivocation.
 */
export function createLocalProjectOwnerIndexRegistrationPortV2(
  authority: CurrentProtocolAuthority,
  owners: DurableLocalProjectOwnerAuthorityResolverV2 &
    Pick<NodeDurableLocalProjectOwnerAuthorityV2, "verifyCheckpointSignature">,
): MainProjectIndexFirstRegistrationPortV2 {
  const port: MainProjectIndexFirstRegistrationPortV2 = {
    async ensureRegistered({ projectId, projectRoot }) {
      const resolution = await resolvePortableProjectData(projectRoot)
      if (resolution.status === "unsupported-project-data") throw resolution.error
      if (resolution.status === "recovery-required") {
        throw new Error("Project collaboration reset recovery must finish before first registration")
      }
      const authorityTuple = {
        protocolDigest: authority.protocolDigest,
        schemaDigest: PROJECT_INDEX_PROTOCOL_SCHEMA_ARTIFACT_DIGEST_V2,
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
      return initializeLocalOwnerProjectIndexNativeStoreV2({
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

export async function initializeLocalOwnerProjectIndexNativeStoreV2(input: {
  readonly authority: CurrentProtocolAuthority
  readonly collaborationDirectory: string
  readonly owner: ResolvedLocalProjectOwnerAuthorityV2
  readonly verifyCheckpointSignature: NodeDurableLocalProjectOwnerAuthorityV2["verifyCheckpointSignature"]
}): Promise<ProjectIndexScopeV2> {
  const { authority, owner, collaborationDirectory } = input
  const prepared = await prepareLocalOwnerProjectIndexGenesisV2(input)
  const authorityTuple = {
    protocolDigest: authority.protocolDigest,
    schemaDigest: PROJECT_INDEX_PROTOCOL_SCHEMA_ARTIFACT_DIGEST_V2,
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

export async function verifyPristineLocalOwnerProjectIndexNativeStoreV2(input: {
  readonly authority: CurrentProtocolAuthority
  readonly collaborationDirectory: string
  readonly owner: ResolvedLocalProjectOwnerAuthorityV2
  readonly verifyCheckpointSignature: NodeDurableLocalProjectOwnerAuthorityV2["verifyCheckpointSignature"]
}): Promise<void> {
  const manifest = await readProjectNativeStoreManifest(input.collaborationDirectory, {
    protocolDigest: input.authority.protocolDigest,
    schemaDigest: PROJECT_INDEX_PROTOCOL_SCHEMA_ARTIFACT_DIGEST_V2,
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

async function prepareLocalOwnerProjectIndexGenesisV2(input: {
  readonly authority: CurrentProtocolAuthority
  readonly collaborationDirectory: string
  readonly owner: ResolvedLocalProjectOwnerAuthorityV2
  readonly verifyCheckpointSignature: NodeDurableLocalProjectOwnerAuthorityV2["verifyCheckpointSignature"]
}) {
  const { authority, owner } = input
  const authorityTuple = {
    protocolDigest: authority.protocolDigest,
    schemaDigest: PROJECT_INDEX_PROTOCOL_SCHEMA_ARTIFACT_DIGEST_V2,
    uriProtocolDigest: authority.protocolSchemaBundle.core.uriProtocolDigest,
  } as const
  const scope: ProjectIndexScopeV2 = Object.freeze({
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
    format: "convax.replica-checkpoint/2" as const,
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

const genesisMaterializer: NodeReplicaHeadMaterializerV2 = Object.freeze({
  async inspectFrame() {
    throw new Error("ProjectIndex genesis has no causal frame")
  },
  async applyAcceptedFrame() {
    throw new Error("ProjectIndex genesis has no causal frame")
  },
  actorHeadsDigest: replicaActorHeadSetDigest,
})

export interface MainProjectIndexDescriptorV2 {
  readonly createDocument: YjsDocumentFactory["createDocument"]
  readonly incomingFacts: IncomingOwnerFactResolverPort
  readonly requiredBlobDigests: (frame: DecodedCausalEditFrame) => readonly Digest[]
  readonly facts: ProjectIndexFactResolutionPortV2
  readonly canvasGenesis: ProjectCanvasGenesisStagingPortV2
}

interface OpenProjectIndexEntryV2 {
  readonly scope: ProjectIndexScopeV2
  readonly project: ProjectCollaborationRuntimeLeaseV2
  readonly runtime: MainCollaborationProductionRuntimeV2<"project-index">
  readonly session: MainCollaborationDocumentSessionV2<"project-index">
  readonly application: ProjectIndexCanvasApplicationPortV2 & ProjectIndexCurrentBlobReferencePortV2
  readonly fileApplication: ProjectIndexFileApplicationPortV2 & ProjectIndexFileMaterializationProjectionPortV2
  readonly disposeFileMaterialization: () => void
}

/**
 * Main-only ProjectIndex owner. It is the sole catalog application registry;
 * neither IPC nor Desktop services cache ProjectIndex JSON/projections.
 */
export class MainProjectIndexRuntimeRegistryV2
  implements
    ProjectIndexCanvasApplicationPortV2,
    ProjectIndexCurrentBlobReferencePortV2,
    ProjectIndexFileApplicationPortV2,
    ProjectIndexFileMaterializationProjectionPortV2
{
  private readonly entries = new Map<string, Promise<OpenProjectIndexEntryV2>>()
  private readonly lanes = new Map<string, Promise<void>>()
  private disposed = false

  constructor(
    private readonly options: {
      readonly authority: CurrentProtocolAuthority
      readonly projects: Pick<NodeProjectCollaborationRuntimeCoordinatorV2, "acquire" | "resolveProjectRoot">
      readonly firstRegistration: MainProjectIndexFirstRegistrationPortV2
      readonly materializers: ProjectCollaborationMaterializerRegistryV2
      readonly localAuthority: CurrentLocalReplicaAuthoritySourceV2
      readonly incomingAuthority: IncomingReplicaAuthoritySourceV2
      readonly signatureVerifier: CollaborationKernelOptions["signatureVerifier"]
      readonly createOperationId: () => Id128
      readonly createShardEpoch: () => Id128
      describeProjectIndex(input: {
        readonly scope: ProjectIndexScopeV2
        readonly owner: DocumentOwnerRuntime<"project-index">
        readonly project: ProjectCollaborationRuntimeLeaseV2
        readonly blobs: ProjectBlobReplicationStoreV2
      }): MainProjectIndexDescriptorV2
    },
  ) {}

  async queryCatalog(input: Parameters<ProjectIndexCanvasApplicationPortV2["queryCatalog"]>[0]) {
    const projectId = parseProjectId(input.projectId)
    return (await this.open(projectId)).application.queryCatalog({ projectId })
  }

  async submitRouteCommand(input: Parameters<ProjectIndexCanvasApplicationPortV2["submitRouteCommand"]>[0]) {
    const projectId = parseProjectId(input.projectId)
    return (await this.open(projectId)).application.submitRouteCommand({ ...input, projectId })
  }

  async queryCurrentBlobDigests(
    input: Parameters<ProjectIndexCurrentBlobReferencePortV2["queryCurrentBlobDigests"]>[0],
  ) {
    const projectId = parseProjectId(input.projectId)
    return queryMainProjectIndexCurrentBlobDigestsV2((await this.open(projectId)).application, { projectId })
  }

  async queryCurrentResources(
    input: Parameters<ProjectIndexCurrentBlobReferencePortV2["queryCurrentResources"]>[0],
  ) {
    const projectId = parseProjectId(input.projectId)
    return (await this.open(projectId)).application.queryCurrentResources({ projectId })
  }

  async createDirectory(input: Parameters<ProjectIndexFileApplicationPortV2["createDirectory"]>[0]) {
    const projectId = parseProjectId(input.projectId)
    return (await this.open(projectId)).fileApplication.createDirectory({ ...input, projectId })
  }

  async admitManagedBlob(input: Parameters<ProjectIndexFileApplicationPortV2["admitManagedBlob"]>[0]) {
    const projectId = parseProjectId(input.projectId)
    return (await this.open(projectId)).fileApplication.admitManagedBlob({ ...input, projectId })
  }

  async publishFile(input: Parameters<ProjectIndexFileApplicationPortV2["publishFile"]>[0]) {
    const projectId = parseProjectId(input.projectId)
    return (await this.open(projectId)).fileApplication.publishFile({ ...input, projectId })
  }

  async relocateEntry(input: Parameters<ProjectIndexFileApplicationPortV2["relocateEntry"]>[0]) {
    const projectId = parseProjectId(input.projectId)
    return (await this.open(projectId)).fileApplication.relocateEntry({ ...input, projectId })
  }

  async tombstoneEntry(input: Parameters<ProjectIndexFileApplicationPortV2["tombstoneEntry"]>[0]) {
    const projectId = parseProjectId(input.projectId)
    return (await this.open(projectId)).fileApplication.tombstoneEntry({ ...input, projectId })
  }

  async queryFileMaterializationPlan(
    input: Parameters<ProjectIndexFileMaterializationProjectionPortV2["queryFileMaterializationPlan"]>[0],
  ) {
    const projectId = parseProjectId(input.projectId)
    return (await this.open(projectId)).fileApplication.queryFileMaterializationPlan({ projectId })
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

  private open(projectId: ReturnType<typeof parseProjectId>): Promise<OpenProjectIndexEntryV2> {
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

  private async openFresh(projectId: ReturnType<typeof parseProjectId>): Promise<OpenProjectIndexEntryV2> {
    const projectRoot = await this.options.projects.resolveProjectRoot(projectId)
    const registeredScope = await this.options.firstRegistration.ensureRegistered({ projectId, projectRoot })
    if (registeredScope.projectId !== projectId) throw new Error("ProjectIndex first-register crossed Project identity")
    const project = await this.options.projects.acquire(projectId)
    let runtime: MainCollaborationProductionRuntimeV2<"project-index"> | undefined
    let session: MainCollaborationDocumentSessionV2<"project-index"> | undefined
    let disposeFileMaterialization: (() => void) | undefined
    try {
      if (project.projectRoot !== projectRoot)
        throw new Error("Project binding changed during ProjectIndex first-register")
      const owner = createMainProjectIndexOwnerRuntimeV2(this.options.authority)
      const blobs = await ProjectBlobReplicationStoreV2.open({
        collaborationDirectory: project.collaborationDirectory,
        projectId,
        projectEpoch: registeredScope.projectEpoch,
        protocolDigest: this.options.authority.protocolDigest,
      })
      const descriptor = this.options.describeProjectIndex({ scope: registeredScope, owner, project, blobs })
      runtime = await createMainCollaborationProductionRuntimeV2({
        authority: this.options.authority,
        scope: registeredScope,
        owner,
        actorId: project.localActorId,
        localAuthority: this.options.localAuthority,
        incomingAuthority: this.options.incomingAuthority,
        incomingFacts: descriptor.incomingFacts,
        createDocument: descriptor.createDocument,
        requiredBlobDigests: descriptor.requiredBlobDigests,
        persistence: project.persistence,
        materializers: this.options.materializers,
      })
      session = await createKernelBackedMainCollaborationDocumentSessionV2({
        authority: this.options.authority,
        scope: registeredScope,
        owner,
        ports: runtime.ports,
        signatureVerifier: this.options.signatureVerifier,
        createOperationId: this.options.createOperationId,
      })
      const application = new ProjectIndexCanvasApplicationV2({
        session,
        facts: descriptor.facts,
        genesis: descriptor.canvasGenesis,
        createOperationId: this.options.createOperationId,
        createShardEpoch: this.options.createShardEpoch,
      })
      const fileApplication = new ProjectIndexFileApplicationV2({
        session,
        facts: descriptor.facts,
        blobs: {
          admitManaged: ({ reference, admission }) =>
            blobs.admitVerifiedStream(reference, admission).then(() => undefined),
          publish: ({ reference, exactBytes }) => blobs.admitVerifiedBytes(reference, exactBytes).then(() => undefined),
        },
        createOperationId: this.options.createOperationId,
      })
      const fileMaterializer = await ProjectIndexFileMaterializerV2.open({
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
export async function queryMainProjectIndexCurrentBlobDigestsV2(
  application: ProjectIndexCurrentBlobReferencePortV2,
  input: Parameters<ProjectIndexCurrentBlobReferencePortV2["queryCurrentBlobDigests"]>[0],
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

export function createMainProjectIndexOwnerRuntimeV2(
  authority: CurrentProtocolAuthority,
): DocumentOwnerRuntime<"project-index"> {
  const selected = createSelectedDocumentOwnerArtifactFactory(authority, "project-index").createRuntime(
    selectedProjectIndexDocumentOwnerArtifactDefinitionV2,
  )
  if ("status" in selected) throw new Error(`ProjectIndex owner runtime is ${selected.code}`)
  return selected
}
