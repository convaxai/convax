import { createHash, randomBytes } from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"

export type ProjectResetConfirmationTokenV1 = `reset-host-${string}` & { readonly __projectResetToken: unique symbol }

export interface ProjectResetDeletePreviewEntryV1 {
  byteLength?: number
  contentDigest?: string
  kind: "directory" | "file"
  path: string
}

export interface PortableProjectResetPlanV1 {
  format: "convax.host-portable-project-reset-plan/1"
  originalTreeDigest: string
  privateDeletionSetDigest: string
  unsupportedInventoryDigest: string
  preview: readonly ProjectResetDeletePreviewEntryV1[]
  projectId: string
  projectRoot: string
  token: ProjectResetConfirmationTokenV1
}

export class UnsupportedPortableProjectVersion extends Error {
  readonly code = "unsupported-portable-version"

  constructor(readonly legacyPaths: readonly string[]) {
    super("Portable Project uses the unsupported catalog/document JSON layout")
    this.name = "UnsupportedPortableProjectVersion"
  }
}

export class PortableProjectResetError extends Error {
  constructor(
    readonly code:
      | "ABORTED"
      | "INVALID_CONFIRMATION"
      | "INVALID_PROJECT"
      | "RECOVERY_REQUIRED"
      | "STALE_PLAN"
      | "VERIFICATION_REJECTED",
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.name = "PortableProjectResetError"
  }
}

export type PortableProjectCutoverInspectionV1 =
  | { status: "current" }
  | { error: UnsupportedPortableProjectVersion; status: "unsupported-portable-project-version" }
  | { artifacts: readonly string[]; status: "recovery-required" }

export interface PortableProjectResetVerifierV1 {
  /**
   * The injected control/Project protocol owner verifies and durably stages the
   * exact frozen confirmation, approval and rollover objects. This native helper
   * deliberately does not define, partially decode, or weaken those DTOs.
   */
  authorizeStagedReset(input: {
    authorizationEvidence: unknown
    authorizationKind: "local-project-owner" | "team-epoch-rollover"
    executionFingerprint: string
    nextProjectEpoch: string
    originalTreeDigest: string
    privateDeletionSetDigest: string
    projectId: string
    unsupportedInventoryDigest: string
    signal?: AbortSignal
    stagedConvaxDirectory: string
  }): Promise<"team-service-unavailable" | "verified" | "rejected">
  verifyStagedGenesis(input: {
    nextProjectEpoch: string
    originalTreeDigest: string
    privateDeletionSetDigest: string
    projectId: string
    unsupportedInventoryDigest: string
    executionFingerprint: string
    stagedConvaxDirectory: string
    signal?: AbortSignal
  }): Promise<boolean>
  verifyPublishedGenesis(input: {
    executionFingerprint: string
    nextProjectEpoch: string
    originalTreeDigest: string
    privateDeletionSetDigest: string
    projectId: string
    unsupportedInventoryDigest: string
    publishedConvaxDirectory: string
    signal?: AbortSignal
  }): Promise<boolean>
}

export interface ExecutePortableProjectResetV1 {
  authorizationEvidence: unknown
  authorizationKind: "local-project-owner" | "team-epoch-rollover"
  confirmationToken: ProjectResetConfirmationTokenV1
  exclusiveLease: ProjectClosedExclusiveMutationLeaseV1
  faultHooks?: {
    afterOriginalRenamed?(): Promise<void>
    beforePublish?(): Promise<void>
  }
  nextProjectEpoch: string
  signal?: AbortSignal
  stageGenesis(input: {
    nextProjectEpoch: string
    projectId: string
    stagedConvaxDirectory: string
    signal?: AbortSignal
  }): Promise<void>
  verifier: PortableProjectResetVerifierV1
}

export interface ProjectClosedExclusiveMutationLeaseV1 {
  readonly format: "convax.host-project-closed-exclusive-mutation-lease/1"
  readonly projectId: string
  readonly projectRoot: string
}

export type PortableProjectResetResultV1 =
  | { reason: "team-service-unavailable" | "cancelled"; stagedConvaxDirectory: string; status: "staged" }
  | { projectId: string; status: "published" }

const recoveryPrefix = ".convax-reset-recovery-"
const stagePrefix = ".convax-reset-stage-"
const backupPrefix = ".convax-reset-backup-"
const resetDomain = Buffer.from("convax.host-portable-project-reset/1\0", "utf8")
const resetIntentDomain = Buffer.from("convax.host-portable-project-reset-execution/1\0", "utf8")
const recoveryMagic = Buffer.from("CVXRST01", "ascii")
const activeExclusiveLeases = new WeakSet()

interface TreeEntry extends ProjectResetDeletePreviewEntryV1 {}

interface TreeSnapshot {
  digest: string
  entries: TreeEntry[]
  projectId: string
  projectManifest: Buffer
}

export async function inspectPortableProjectCutover(projectRoot: string): Promise<PortableProjectCutoverInspectionV1> {
  const root = await requireAbsoluteProjectRoot(projectRoot)
  await assertPlainDirectoryIfPresent(path.join(root, ".convax"), "Project .convax")
  const artifacts = (await fs.readdir(root))
    .filter((name) => name.startsWith(recoveryPrefix) || name.startsWith(stagePrefix) || name.startsWith(backupPrefix))
    .sort()
  if (artifacts.length > 0) return { artifacts, status: "recovery-required" }
  const legacyPaths = await detectLegacyPaths(root)
  if (legacyPaths.length > 0) {
    return {
      error: new UnsupportedPortableProjectVersion(legacyPaths),
      status: "unsupported-portable-project-version",
    }
  }
  return { status: "current" }
}

export async function planPortableProjectReset(projectRoot: string): Promise<PortableProjectResetPlanV1> {
  const root = await requireAbsoluteProjectRoot(projectRoot)
  const inspection = await inspectPortableProjectCutover(root)
  if (inspection.status === "recovery-required") {
    throw new PortableProjectResetError("RECOVERY_REQUIRED", "A prior Project reset is incomplete")
  }
  if (inspection.status !== "unsupported-portable-project-version") {
    throw new PortableProjectResetError("INVALID_PROJECT", "Project does not require the legacy cutover reset")
  }
  const tree = await snapshotConvaxTree(root)
  const preview = tree.entries
    .filter((entry) => entry.path !== ".convax/project.json")
    .map((entry) => Object.freeze(toPreviewEntry(entry)))
  const privateDeletionSetDigest = digestJson("convax.host-project-reset-deletion-set/1\0", preview)
  const unsupportedInventoryDigest = digestJson(
    "convax.host-project-reset-unsupported-inventory/1\0",
    tree.entries,
  )
  const token = deriveResetToken(root, tree.projectId, tree.digest, preview)
  return Object.freeze({
    format: "convax.host-portable-project-reset-plan/1",
    originalTreeDigest: tree.digest,
    privateDeletionSetDigest,
    preview: Object.freeze(preview),
    projectId: tree.projectId,
    projectRoot: root,
    token,
    unsupportedInventoryDigest,
  })
}

export async function executePortableProjectReset(
  plan: PortableProjectResetPlanV1,
  input: ExecutePortableProjectResetV1,
): Promise<PortableProjectResetResultV1> {
  validatePlan(plan)
  if ((await requireAbsoluteProjectRoot(plan.projectRoot)) !== plan.projectRoot) {
    throw new PortableProjectResetError("INVALID_PROJECT", "Project reset plan root is not canonical")
  }
  assertActiveExclusiveLease(input.exclusiveLease, plan)
  if (
    input.confirmationToken !== plan.token ||
    plan.token !== deriveResetToken(plan.projectRoot, plan.projectId, plan.originalTreeDigest, plan.preview)
  ) {
    throw new PortableProjectResetError(
      "INVALID_CONFIRMATION",
      "Project reset confirmation does not match the exact preview",
    )
  }
  requireEpoch(input.nextProjectEpoch)
  if (input.authorizationKind !== "local-project-owner" && input.authorizationKind !== "team-epoch-rollover") {
    throw new PortableProjectResetError("VERIFICATION_REJECTED", "Project reset authorization kind is invalid")
  }
  const executionFingerprint = derivePortableProjectResetExecutionFingerprint({
    authorizationKind: input.authorizationKind,
    confirmationToken: plan.token,
    nextProjectEpoch: input.nextProjectEpoch,
    originalTreeDigest: plan.originalTreeDigest,
    privateDeletionSetDigest: plan.privateDeletionSetDigest,
    projectId: plan.projectId,
    unsupportedInventoryDigest: plan.unsupportedInventoryDigest,
  })
  throwIfAborted(input.signal)

  const tokenSuffix = plan.token.slice(-24)
  const convaxDirectory = path.join(plan.projectRoot, ".convax")
  const stagedConvaxDirectory = path.join(plan.projectRoot, `${stagePrefix}${tokenSuffix}`)
  const backupDirectory = path.join(plan.projectRoot, `${backupPrefix}${tokenSuffix}`)
  const recoveryPath = path.join(plan.projectRoot, `${recoveryPrefix}${tokenSuffix}.bin`)
  if ((await exists(recoveryPath)) || (await exists(backupDirectory))) {
    throw new PortableProjectResetError("RECOVERY_REQUIRED", "Project reset has ambiguous durable state")
  }

  const current = await snapshotConvaxTree(plan.projectRoot)
  const currentPreview = current.entries.filter((entry) => entry.path !== ".convax/project.json").map(toPreviewEntry)
  if (
    current.digest !== plan.originalTreeDigest ||
    current.projectId !== plan.projectId ||
    digestJson("convax.host-project-reset-deletion-set/1\0", currentPreview) !== plan.privateDeletionSetDigest ||
    digestJson("convax.host-project-reset-unsupported-inventory/1\0", current.entries) !== plan.unsupportedInventoryDigest ||
    JSON.stringify(currentPreview) !== JSON.stringify(plan.preview)
  ) {
    throw new PortableProjectResetError("STALE_PLAN", "Portable Project changed after the reset preview")
  }

  if (!(await exists(stagedConvaxDirectory))) {
    await fs.mkdir(stagedConvaxDirectory, { mode: 0o700 })
    await writeDurableNewFile(path.join(stagedConvaxDirectory, "project.json"), current.projectManifest)
  } else {
    await assertPlainDirectory(stagedConvaxDirectory, "Reset staging directory", "RECOVERY_REQUIRED")
    await assertStagedProjectIdentity(stagedConvaxDirectory, plan.projectId)
  }
  try {
    // Genesis and reset-record publication are strict idempotent constructors.
    // Re-run them for an existing stage so a crash before their final rename is
    // repairable without weakening the exact plan/fingerprint verification.
    await input.stageGenesis({
      nextProjectEpoch: input.nextProjectEpoch,
      projectId: plan.projectId,
      signal: input.signal,
      stagedConvaxDirectory,
    })
    await fsyncTree(stagedConvaxDirectory)
  } catch (error) {
    if (input.signal?.aborted) {
      return { reason: "cancelled", stagedConvaxDirectory, status: "staged" }
    }
    throw error
  }

  if (input.signal?.aborted) return { reason: "cancelled", stagedConvaxDirectory, status: "staged" }
  await assertPlainDirectory(stagedConvaxDirectory, "Reset staging directory", "RECOVERY_REQUIRED")
  const authorization = await input.verifier.authorizeStagedReset({
    authorizationEvidence: input.authorizationEvidence,
    authorizationKind: input.authorizationKind,
    executionFingerprint,
    nextProjectEpoch: input.nextProjectEpoch,
    originalTreeDigest: plan.originalTreeDigest,
    privateDeletionSetDigest: plan.privateDeletionSetDigest,
    projectId: plan.projectId,
    unsupportedInventoryDigest: plan.unsupportedInventoryDigest,
    signal: input.signal,
    stagedConvaxDirectory,
  })
  if (authorization === "team-service-unavailable") {
    return { reason: "team-service-unavailable", stagedConvaxDirectory, status: "staged" }
  }
  if (authorization !== "verified") {
    throw new PortableProjectResetError("VERIFICATION_REJECTED", "Project reset authorization was rejected")
  }
  if (input.signal?.aborted) return { reason: "cancelled", stagedConvaxDirectory, status: "staged" }
  await fsyncTree(stagedConvaxDirectory)
  await assertStagedProjectIdentity(stagedConvaxDirectory, plan.projectId)
  const genesisVerified = await input.verifier.verifyStagedGenesis({
    executionFingerprint,
    nextProjectEpoch: input.nextProjectEpoch,
    originalTreeDigest: plan.originalTreeDigest,
    privateDeletionSetDigest: plan.privateDeletionSetDigest,
    projectId: plan.projectId,
    unsupportedInventoryDigest: plan.unsupportedInventoryDigest,
    signal: input.signal,
    stagedConvaxDirectory,
  })
  if (!genesisVerified) {
    throw new PortableProjectResetError("VERIFICATION_REJECTED", "Staged collaboration genesis was rejected")
  }
  await input.faultHooks?.beforePublish?.()
  await fsyncTree(stagedConvaxDirectory)
  const stagedTreeDigest = await snapshotDirectoryDigest(stagedConvaxDirectory)

  const immediatelyBeforePublish = await snapshotConvaxTree(plan.projectRoot)
  if (
    immediatelyBeforePublish.digest !== plan.originalTreeDigest ||
    immediatelyBeforePublish.projectId !== plan.projectId
  ) {
    throw new PortableProjectResetError("STALE_PLAN", "Portable Project changed before reset publication")
  }
  const [rootStat, stageStat] = await Promise.all([
    fs.stat(plan.projectRoot),
    assertPlainDirectory(stagedConvaxDirectory, "Reset staging directory", "RECOVERY_REQUIRED"),
  ])
  if (rootStat.dev !== stageStat.dev) {
    throw new PortableProjectResetError("INVALID_PROJECT", "Reset staging must be on the Project filesystem")
  }

  const recoveryEnvelope = encodeRecoveryEnvelope({
    backupDirectory: path.basename(backupDirectory),
    originalTreeDigest: plan.originalTreeDigest,
    projectId: plan.projectId,
    stageDirectory: path.basename(stagedConvaxDirectory),
    stagedTreeDigest,
    token: plan.token,
  })
  await writeDurableNewFile(recoveryPath, recoveryEnvelope)
  await fsyncDirectory(plan.projectRoot)
  try {
    await assertPlainDirectory(convaxDirectory, "Project .convax", "RECOVERY_REQUIRED")
    await assertPlainDirectory(stagedConvaxDirectory, "Reset staging directory", "RECOVERY_REQUIRED")
    await fs.rename(convaxDirectory, backupDirectory)
    await fsyncDirectory(plan.projectRoot)
    await input.faultHooks?.afterOriginalRenamed?.()
    await fs.rename(stagedConvaxDirectory, convaxDirectory)
    await fsyncDirectory(plan.projectRoot)
    if ((await snapshotDirectoryDigest(convaxDirectory)) !== stagedTreeDigest) {
      throw new Error("Published Project tree differs from the verified staged tree")
    }
    if (
      !(await input.verifier.verifyPublishedGenesis({
        executionFingerprint,
        nextProjectEpoch: input.nextProjectEpoch,
        originalTreeDigest: plan.originalTreeDigest,
        privateDeletionSetDigest: plan.privateDeletionSetDigest,
        projectId: plan.projectId,
        unsupportedInventoryDigest: plan.unsupportedInventoryDigest,
        publishedConvaxDirectory: convaxDirectory,
        signal: input.signal,
      }))
    ) {
      throw new Error("Published collaboration genesis was rejected on reopen")
    }
    if ((await snapshotDirectoryDigest(backupDirectory)) !== plan.originalTreeDigest) {
      throw new Error("Retired Project tree differs from the confirmed deletion set")
    }
    await fs.rm(backupDirectory, { recursive: true })
    await fsyncDirectory(plan.projectRoot)
    await fs.rm(recoveryPath)
    await fsyncDirectory(plan.projectRoot)
    return { projectId: plan.projectId, status: "published" }
  } catch (error) {
    throw new PortableProjectResetError(
      "RECOVERY_REQUIRED",
      "Project reset publication has ambiguous durable state and requires explicit recovery",
      { cause: error },
    )
  }
}

export function derivePortableProjectResetExecutionFingerprint(input: {
  authorizationKind: "local-project-owner" | "team-epoch-rollover"
  confirmationToken: ProjectResetConfirmationTokenV1
  nextProjectEpoch: string
  originalTreeDigest: string
  privateDeletionSetDigest: string
  projectId: string
  unsupportedInventoryDigest: string
}) {
  const bytes = Buffer.from(
    JSON.stringify({
      authorizationKind: input.authorizationKind,
      confirmationToken: input.confirmationToken,
      format: "convax.host-portable-project-reset-execution/1",
      nextProjectEpoch: input.nextProjectEpoch,
      originalTreeDigest: input.originalTreeDigest,
      privateDeletionSetDigest: input.privateDeletionSetDigest,
      projectId: input.projectId,
      unsupportedInventoryDigest: input.unsupportedInventoryDigest,
    }),
    "utf8",
  )
  return createHash("sha256").update(resetIntentDomain).update(bytes).digest("hex")
}

/** Allocate a new reset-scoped Project epoch for a Project proven never to have enabled team collaboration. */
export function allocateLocalProjectEpoch() {
  return randomBytes(16).toString("base64url")
}

/** @internal The Project lifecycle owner must call this only inside its serialized close gate. */
export async function runWithProjectClosedExclusiveMutationLease<T>(
  input: { projectId: string; projectRoot: string },
  operation: (lease: ProjectClosedExclusiveMutationLeaseV1) => Promise<T>,
): Promise<T> {
  const lease = Object.freeze({
    format: "convax.host-project-closed-exclusive-mutation-lease/1" as const,
    projectId: input.projectId,
    projectRoot: path.resolve(input.projectRoot),
  })
  activeExclusiveLeases.add(lease)
  try {
    return await operation(lease)
  } finally {
    activeExclusiveLeases.delete(lease)
  }
}

async function detectLegacyPaths(projectRoot: string) {
  const legacy: string[] = []
  const catalog = path.join(projectRoot, ".convax", "canvases", "catalog.json")
  if (await exists(catalog)) legacy.push(".convax/canvases/catalog.json")
  const canvases = path.join(projectRoot, ".convax", "canvases")
  const canvasesStat = await lstatOrNull(canvases)
  if (canvasesStat?.isSymbolicLink()) {
    throw new PortableProjectResetError("INVALID_PROJECT", "Legacy Canvas metadata cannot be a symbolic link")
  }
  if (canvasesStat?.isDirectory()) {
    for (const dirent of (await fs.readdir(canvases, { withFileTypes: true })).sort((left, right) =>
      compareUtf8(left.name, right.name),
    )) {
      if (dirent.isSymbolicLink()) {
        throw new PortableProjectResetError("INVALID_PROJECT", "Legacy Canvas metadata cannot contain symbolic links")
      }
      if (!dirent.isDirectory()) continue
      const document = path.join(canvases, dirent.name, "document.json")
      if (await exists(document)) legacy.push(`.convax/canvases/${dirent.name}/document.json`)
    }
  }
  const collaboration = path.join(projectRoot, ".convax", "collaboration")
  const collaborationStat = await lstatOrNull(collaboration)
  if (collaborationStat?.isSymbolicLink()) {
    throw new PortableProjectResetError("INVALID_PROJECT", "Collaboration metadata cannot be a symbolic link")
  }
  if (collaborationStat && !collaborationStat.isDirectory()) {
    throw new PortableProjectResetError("INVALID_PROJECT", "Collaboration metadata must be a directory")
  }
  if (collaborationStat?.isDirectory()) {
    const manifest = path.join(collaboration, "manifest-v2.bin")
    if (!(await exists(manifest))) legacy.push(".convax/collaboration")
    else await readStablePlainFile(manifest, "INVALID_PROJECT")
  }
  return legacy.sort(compareUtf8)
}

async function snapshotConvaxTree(projectRoot: string): Promise<TreeSnapshot> {
  const convaxDirectory = path.join(projectRoot, ".convax")
  await assertPlainDirectory(convaxDirectory, "Project .convax", "INVALID_PROJECT")
  const entries: TreeEntry[] = []
  await walkTree(convaxDirectory, ".convax", entries)
  const projectManifestPath = path.join(convaxDirectory, "project.json")
  const projectManifest = await readStablePlainFile(projectManifestPath, "INVALID_PROJECT").catch((error) => {
    throw new PortableProjectResetError("INVALID_PROJECT", "Project identity manifest is missing", { cause: error })
  })
  const projectId = parseStableProjectId(projectManifest)
  return {
    digest: digestTree(entries, projectId),
    entries,
    projectId,
    projectManifest,
  }
}

async function snapshotDirectoryDigest(directory: string): Promise<string> {
  await assertPlainDirectory(directory, "Reset tree", "RECOVERY_REQUIRED")
  const entries: TreeEntry[] = []
  await walkTree(directory, ".convax", entries)
  const projectManifest = await readStablePlainFile(path.join(directory, "project.json"), "RECOVERY_REQUIRED").catch(
    (error) => {
      throw new PortableProjectResetError("RECOVERY_REQUIRED", "Reset tree Project identity is missing", {
        cause: error,
      })
    },
  )
  return digestTree(entries, parseStableProjectId(projectManifest))
}

function digestTree(entries: readonly TreeEntry[], projectId: string) {
  return createHash("sha256")
    .update(resetDomain)
    .update(Buffer.from(JSON.stringify({ entries, projectId }), "utf8"))
    .digest("hex")
}

function digestJson(domain: string, value: unknown) {
  return createHash("sha256").update(domain, "utf8").update(JSON.stringify(value), "utf8").digest("hex")
}

async function walkTree(directory: string, relativeDirectory: string, output: TreeEntry[]): Promise<void> {
  for (const dirent of (await fs.readdir(directory, { withFileTypes: true })).sort((left, right) =>
    compareUtf8(left.name, right.name),
  )) {
    const absolute = path.join(directory, dirent.name)
    const relative = `${relativeDirectory}/${dirent.name}`
    if (dirent.isSymbolicLink()) {
      throw new PortableProjectResetError("INVALID_PROJECT", `Portable metadata contains a symbolic link: ${relative}`)
    }
    if (dirent.isDirectory()) {
      output.push({ kind: "directory", path: relative })
      await walkTree(absolute, relative, output)
      continue
    }
    if (!dirent.isFile()) {
      throw new PortableProjectResetError(
        "INVALID_PROJECT",
        `Portable metadata contains an unsupported entry: ${relative}`,
      )
    }
    const bytes = await readStablePlainFile(absolute, "INVALID_PROJECT")
    output.push({
      byteLength: bytes.byteLength,
      contentDigest: createHash("sha256").update(bytes).digest("hex"),
      kind: "file",
      path: relative,
    })
  }
}

async function readStablePlainFile(
  target: string,
  code: "INVALID_PROJECT" | "RECOVERY_REQUIRED" | "VERIFICATION_REJECTED",
) {
  const before = await fs.lstat(target, { bigint: true })
  if (before.isSymbolicLink() || !before.isFile()) {
    throw new PortableProjectResetError(code, `Portable metadata is not a plain file: ${target}`)
  }
  const bytes = await fs.readFile(target)
  const after = await fs.lstat(target, { bigint: true })
  if (
    after.isSymbolicLink() ||
    !after.isFile() ||
    before.dev !== after.dev ||
    before.ino !== after.ino ||
    before.size !== after.size ||
    before.mtimeNs !== after.mtimeNs ||
    before.ctimeNs !== after.ctimeNs
  ) {
    throw new PortableProjectResetError(code, `Portable metadata changed while it was inspected: ${target}`)
  }
  return bytes
}

function compareUtf8(left: string, right: string) {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"))
}

function toPreviewEntry(entry: TreeEntry): ProjectResetDeletePreviewEntryV1 {
  if (entry.kind === "directory") return { kind: "directory", path: entry.path }
  return {
    byteLength: entry.byteLength,
    contentDigest: entry.contentDigest,
    kind: "file",
    path: entry.path,
  }
}

function parseStableProjectId(bytes: Buffer) {
  let value: unknown
  try {
    value = JSON.parse(bytes.toString("utf8"))
  } catch (error) {
    throw new PortableProjectResetError("INVALID_PROJECT", "Project identity manifest is invalid JSON", {
      cause: error,
    })
  }
  if (!isExactRecord(value, ["projectId", "schemaVersion"]) || value.schemaVersion !== "convax.project/1") {
    throw new PortableProjectResetError("INVALID_PROJECT", "Project identity manifest is unsupported")
  }
  if (typeof value.projectId !== "string" || !/^[a-z0-9][a-z0-9_-]{0,95}$/u.test(value.projectId)) {
    throw new PortableProjectResetError("INVALID_PROJECT", "Project identity is invalid")
  }
  return value.projectId
}

async function assertStagedProjectIdentity(stagedConvaxDirectory: string, projectId: string) {
  const bytes = await readStablePlainFile(path.join(stagedConvaxDirectory, "project.json"), "VERIFICATION_REJECTED")
  if (parseStableProjectId(bytes) !== projectId) {
    throw new PortableProjectResetError("VERIFICATION_REJECTED", "Staged genesis changed stable Project identity")
  }
}

function validatePlan(plan: PortableProjectResetPlanV1) {
  if (
    !isExactRecord(plan, [
      "format",
      "originalTreeDigest",
      "privateDeletionSetDigest",
      "preview",
      "projectId",
      "projectRoot",
      "token",
      "unsupportedInventoryDigest",
    ]) ||
    plan.format !== "convax.host-portable-project-reset-plan/1" ||
    !path.isAbsolute(plan.projectRoot) ||
    !/^[0-9a-f]{64}$/u.test(plan.originalTreeDigest) ||
    !/^[0-9a-f]{64}$/u.test(plan.privateDeletionSetDigest) ||
    !/^[0-9a-f]{64}$/u.test(plan.unsupportedInventoryDigest) ||
    !Array.isArray(plan.preview)
  ) {
    throw new PortableProjectResetError("INVALID_CONFIRMATION", "Project reset plan is invalid")
  }
}

function assertActiveExclusiveLease(lease: ProjectClosedExclusiveMutationLeaseV1, plan: PortableProjectResetPlanV1) {
  if (
    !activeExclusiveLeases.has(lease) ||
    lease.format !== "convax.host-project-closed-exclusive-mutation-lease/1" ||
    lease.projectId !== plan.projectId ||
    path.resolve(lease.projectRoot) !== plan.projectRoot
  ) {
    throw new PortableProjectResetError(
      "RECOVERY_REQUIRED",
      "Project reset requires an active closed-Project exclusive mutation lease",
    )
  }
}

function deriveResetToken(
  projectRoot: string,
  projectId: string,
  treeDigest: string,
  preview: readonly ProjectResetDeletePreviewEntryV1[],
): ProjectResetConfirmationTokenV1 {
  const bytes = Buffer.from(JSON.stringify({ preview, projectId, projectRoot, treeDigest }), "utf8")
  return `reset-host-${createHash("sha256").update(resetDomain).update(bytes).digest("hex")}` as ProjectResetConfirmationTokenV1
}

function encodeRecoveryEnvelope(value: Record<string, string>) {
  const payload = Buffer.from(JSON.stringify(value), "utf8")
  const length = Buffer.allocUnsafe(4)
  length.writeUInt32BE(payload.byteLength)
  return Buffer.concat([recoveryMagic, length, createHash("sha256").update(payload).digest(), payload])
}

async function fsyncTree(directory: string): Promise<void> {
  for (const dirent of await fs.readdir(directory, { withFileTypes: true })) {
    const target = path.join(directory, dirent.name)
    if (dirent.isSymbolicLink() || (!dirent.isDirectory() && !dirent.isFile())) {
      throw new PortableProjectResetError(
        "VERIFICATION_REJECTED",
        "Staged genesis contains unsupported filesystem entries",
      )
    }
    if (dirent.isDirectory()) await fsyncTree(target)
    else {
      const handle = await fs.open(target, "r")
      try {
        await handle.sync()
      } finally {
        await handle.close()
      }
    }
  }
  await fsyncDirectory(directory)
}

async function writeDurableNewFile(target: string, bytes: Uint8Array) {
  const handle = await fs.open(target, "wx", 0o600)
  try {
    await handle.writeFile(bytes)
    await handle.sync()
  } finally {
    await handle.close()
  }
}

async function fsyncDirectory(directory: string) {
  const handle = await fs.open(directory, "r")
  try {
    await handle.sync()
  } finally {
    await handle.close()
  }
}

async function requireAbsoluteProjectRoot(projectRoot: string) {
  if (!path.isAbsolute(projectRoot)) {
    throw new PortableProjectResetError("INVALID_PROJECT", "Project root must be absolute")
  }
  const resolved = path.resolve(projectRoot)
  const stat = await fs.lstat(resolved)
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new PortableProjectResetError("INVALID_PROJECT", "Project root must be a real directory")
  }
  const real = await fs.realpath(resolved)
  return real
}

function requireEpoch(value: string) {
  if (!/^[A-Za-z0-9_-]{22}$/u.test(value) || Buffer.from(value, "base64url").toString("base64url") !== value) {
    throw new PortableProjectResetError("VERIFICATION_REJECTED", "Next Project epoch is not canonical")
  }
}

function throwIfAborted(signal?: AbortSignal) {
  if (!signal?.aborted) return
  throw new PortableProjectResetError("ABORTED", "Project reset was cancelled", { cause: signal.reason })
}

function isExactRecord(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return Boolean(
    value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      Object.keys(value).sort().join("\0") === [...keys].sort().join("\0"),
  )
}

async function exists(target: string) {
  try {
    await fs.access(target)
    return true
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return false
    throw error
  }
}

async function lstatOrNull(target: string) {
  try {
    return await fs.lstat(target)
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return null
    throw error
  }
}

async function assertPlainDirectoryIfPresent(target: string, label: string) {
  const stat = await lstatOrNull(target)
  if (!stat) return
  if (stat.isSymbolicLink()) {
    throw new PortableProjectResetError("INVALID_PROJECT", `${label} cannot be a symbolic link`)
  }
  if (!stat.isDirectory()) {
    throw new PortableProjectResetError("INVALID_PROJECT", `${label} must be a real directory`)
  }
}

async function assertPlainDirectory(
  target: string,
  label: string,
  code: "INVALID_PROJECT" | "RECOVERY_REQUIRED" | "VERIFICATION_REJECTED",
) {
  const stat = await lstatOrNull(target)
  if (stat?.isSymbolicLink()) {
    throw new PortableProjectResetError(code, `${label} cannot be a symbolic link`)
  }
  if (!stat?.isDirectory()) {
    throw new PortableProjectResetError(code, `${label} must be a real directory`)
  }
  return stat
}
