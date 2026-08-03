import { createHash, randomUUID } from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"
import {
  decodeRestrictedJcsV2,
  encodeRestrictedJcsV2,
  parseDigestV2,
  parseId128V2,
  parseMemberIdV2,
  parseProjectIdV2,
  parseUint32V2,
  parseUint64V2,
  type DigestV2,
  type Id128V2,
  type MemberIdV2,
  type ProjectIdV2,
  type StableRemoteTransferKeyV2,
  type Uint32V2,
  type Uint64V2,
} from "@convax/collaboration"
import { deriveObjectNativeKeyV2 } from "./native-store-keys"

export type RemoteIngressEvidenceMapKindV2 = "stable-key-state" | "member-quota"

export type RemoteIngressEvidenceMapLeafEntryV2 =
  | Readonly<{
      mapKind: "stable-key-state"
      keyDigest: DigestV2
      stableKey: StableRemoteTransferKeyV2
      valueRecordDigest: DigestV2
    }>
  | Readonly<{
      mapKind: "member-quota"
      keyDigest: DigestV2
      sourceMemberId: MemberIdV2
      valueRecordDigest: DigestV2
    }>

export interface RemoteIngressEvidenceMapRootRecordV2 {
  readonly format: "convax.remote-ingress-evidence-map-root-record/2"
  readonly projectId: ProjectIdV2
  readonly projectEpoch: Id128V2
  readonly mapKind: RemoteIngressEvidenceMapKindV2
  readonly generation: Uint64V2
  readonly rootPageDigest: DigestV2 | null
  readonly entryCount: Uint64V2
  readonly treeHeight: Uint32V2
  readonly mapCommitment: DigestV2
}

type BoundaryV2 =
  | Readonly<{ mapKind: "stable-key-state"; keyDigest: DigestV2; stableKey: StableRemoteTransferKeyV2 }>
  | Readonly<{ mapKind: "member-quota"; keyDigest: DigestV2; sourceMemberId: MemberIdV2 }>

interface ChildV2 {
  readonly firstKey: BoundaryV2
  readonly lastKey: BoundaryV2
  readonly childPageRecordDigest: DigestV2
  readonly childSubtreeEntryCount: Uint64V2
}

interface LeafPageV2 {
  readonly format: "convax.remote-ingress-evidence-map-leaf-page-record/2"
  readonly projectId: ProjectIdV2
  readonly projectEpoch: Id128V2
  readonly mapKind: RemoteIngressEvidenceMapKindV2
  readonly height: "0"
  readonly entries: readonly RemoteIngressEvidenceMapLeafEntryV2[]
  readonly subtreeEntryCount: Uint64V2
}

interface InternalPageV2 {
  readonly format: "convax.remote-ingress-evidence-map-internal-page-record/2"
  readonly projectId: ProjectIdV2
  readonly projectEpoch: Id128V2
  readonly mapKind: RemoteIngressEvidenceMapKindV2
  readonly height: Uint32V2
  readonly children: readonly ChildV2[]
  readonly subtreeEntryCount: Uint64V2
}

type PageV2 = LeafPageV2 | InternalPageV2

interface BuiltPageV2 {
  readonly digest: DigestV2
  readonly first: BoundaryV2
  readonly last: BoundaryV2
  readonly count: bigint
  readonly height: number
}

const MAX_PAGE_BYTES = 65_536
const LEAF_MAX = 128
const LEAF_MIN = 64
const INTERNAL_MAX = 74
const INTERNAL_MIN = 37
const MAX_HEIGHT = 9

/** Fixed-geometry immutable COW74 map used only by the Project-epoch admission head. */
export class ProjectRemoteIngressCowMapV2 {
  readonly #projectId: ProjectIdV2
  readonly #projectEpoch: Id128V2
  readonly #mapKind: RemoteIngressEvidenceMapKindV2
  readonly #pages: string
  readonly #roots: string

  private constructor(input: {
    projectId: ProjectIdV2
    projectEpoch: Id128V2
    mapKind: RemoteIngressEvidenceMapKindV2
    pages: string
    roots: string
  }) {
    this.#projectId = input.projectId
    this.#projectEpoch = input.projectEpoch
    this.#mapKind = input.mapKind
    this.#pages = input.pages
    this.#roots = input.roots
  }

  static async open(input: {
    readonly admissionDirectory: string
    readonly projectId: ProjectIdV2
    readonly projectEpoch: Id128V2
    readonly mapKind: RemoteIngressEvidenceMapKindV2
  }): Promise<ProjectRemoteIngressCowMapV2> {
    if (!path.isAbsolute(input.admissionDirectory)) throw new TypeError("Admission directory must be absolute")
    const projectId = parseProjectIdV2(input.projectId)
    const projectEpoch = parseId128V2(input.projectEpoch)
    const mapKind = parseMapKind(input.mapKind)
    const root = path.join(input.admissionDirectory, "maps", mapKind)
    const pages = path.join(root, "pages")
    const roots = path.join(root, "roots")
    await ensureRealDirectory(pages)
    await ensureRealDirectory(roots)
    return new ProjectRemoteIngressCowMapV2({ projectId, projectEpoch, mapKind, pages, roots })
  }

  async publish(
    inputEntries: readonly RemoteIngressEvidenceMapLeafEntryV2[],
    generationInput: Uint64V2,
  ): Promise<Readonly<{ record: RemoteIngressEvidenceMapRootRecordV2; digest: DigestV2 }>> {
    const generation = parseUint64V2(generationInput)
    const entries = inputEntries.map((entry) => parseEntry(entry, this.#projectId, this.#projectEpoch, this.#mapKind))
      .sort(compareEntry)
    for (let index = 1; index < entries.length; index += 1) {
      if (compareEntry(entries[index - 1]!, entries[index]!) === 0) throw new Error("COW map contains a duplicate canonical key")
    }
    let level: BuiltPageV2[] = []
    if (entries.length > 0) {
      for (const group of distribute(entries, LEAF_MAX, LEAF_MIN)) {
        const page: LeafPageV2 = Object.freeze({
          format: "convax.remote-ingress-evidence-map-leaf-page-record/2",
          projectId: this.#projectId,
          projectEpoch: this.#projectEpoch,
          mapKind: this.#mapKind,
          height: "0",
          entries: Object.freeze(group),
          subtreeEntryCount: String(group.length) as Uint64V2,
        })
        const digest = await this.#putPage(page)
        level.push({ digest, first: boundary(group[0]!), last: boundary(group.at(-1)!), count: BigInt(group.length), height: 0 })
      }
      while (level.length > 1) {
        if (level[0]!.height >= MAX_HEIGHT) throw new Error("COW map exceeds height 9")
        const next: BuiltPageV2[] = []
        for (const group of distribute(level, INTERNAL_MAX, INTERNAL_MIN)) {
          const children = group.map((child): ChildV2 => Object.freeze({
            firstKey: child.first,
            lastKey: child.last,
            childPageRecordDigest: child.digest,
            childSubtreeEntryCount: String(child.count) as Uint64V2,
          }))
          const count = group.reduce((sum, child) => sum + child.count, 0n)
          const height = group[0]!.height + 1
          const page: InternalPageV2 = Object.freeze({
            format: "convax.remote-ingress-evidence-map-internal-page-record/2",
            projectId: this.#projectId,
            projectEpoch: this.#projectEpoch,
            mapKind: this.#mapKind,
            height: String(height) as Uint32V2,
            children: Object.freeze(children),
            subtreeEntryCount: String(count) as Uint64V2,
          })
          const digest = await this.#putPage(page)
          next.push({ digest, first: group[0]!.first, last: group.at(-1)!.last, count, height })
        }
        level = next
      }
    }
    const rootPageDigest = level[0]?.digest ?? null
    const treeHeight = String(level[0]?.height ?? 0) as Uint32V2
    const entryCount = String(entries.length) as Uint64V2
    const mapCommitment = localDigest({
      format: "convax.remote-ingress-evidence-map-commitment/2",
      projectId: this.#projectId,
      projectEpoch: this.#projectEpoch,
      mapKind: this.#mapKind,
      rootPageDigest,
      entryCount,
      treeHeight,
    })
    const record: RemoteIngressEvidenceMapRootRecordV2 = Object.freeze({
      format: "convax.remote-ingress-evidence-map-root-record/2",
      projectId: this.#projectId,
      projectEpoch: this.#projectEpoch,
      mapKind: this.#mapKind,
      generation,
      rootPageDigest,
      entryCount,
      treeHeight,
      mapCommitment,
    })
    const digest = localDigest(record)
    await putImmutable(this.#roots, "remote-ingress-map-root", digest, encodeRestrictedJcsV2(record))
    return Object.freeze({ record, digest })
  }

  async load(rootDigestInput: DigestV2): Promise<Readonly<{
    record: RemoteIngressEvidenceMapRootRecordV2
    entries: readonly RemoteIngressEvidenceMapLeafEntryV2[]
  }>> {
    const rootDigest = parseDigestV2(rootDigestInput)
    const record = parseRoot(
      decodeRestrictedJcsV2(await readImmutable(this.#roots, "remote-ingress-map-root", rootDigest)),
      this.#projectId,
      this.#projectEpoch,
      this.#mapKind,
    )
    if (localDigest(record) !== rootDigest) throw new Error("COW root digest mismatches its pointer")
    if (record.rootPageDigest === null) {
      if (record.entryCount !== "0" || record.treeHeight !== "0") throw new Error("Empty COW root shape is invalid")
      return Object.freeze({ record, entries: Object.freeze([]) })
    }
    const loaded = await this.#loadPage(record.rootPageDigest, Number(record.treeHeight), true)
    if (loaded.entries.length !== Number(record.entryCount)) throw new Error("COW root entry count mismatches")
    return Object.freeze({ record, entries: Object.freeze(loaded.entries) })
  }

  async #putPage(page: PageV2): Promise<DigestV2> {
    const bytes = encodeRestrictedJcsV2(page)
    if (bytes.byteLength > MAX_PAGE_BYTES) throw new Error("COW page exceeds 65,536 bytes")
    const digest = localDigest(page)
    await putImmutable(this.#pages, "remote-ingress-map-page", digest, bytes)
    return digest
  }

  async #loadPage(digest: DigestV2, expectedHeight: number, isRoot: boolean): Promise<{ entries: RemoteIngressEvidenceMapLeafEntryV2[]; first: BoundaryV2; last: BoundaryV2 }> {
    const bytes = await readImmutable(this.#pages, "remote-ingress-map-page", digest)
    if (bytes.byteLength > MAX_PAGE_BYTES) throw new Error("COW page exceeds 65,536 bytes")
    const page = parsePage(decodeRestrictedJcsV2(bytes), this.#projectId, this.#projectEpoch, this.#mapKind)
    if (localDigest(page) !== digest) throw new Error("COW page digest mismatches its pointer")
    if (Number(page.height) !== expectedHeight) throw new Error("COW page height mismatches its parent")
    if (page.format === "convax.remote-ingress-evidence-map-leaf-page-record/2") {
      if (page.entries.length > LEAF_MAX || page.entries.length < (isRoot ? 1 : LEAF_MIN)) throw new Error("COW leaf geometry is invalid")
      return { entries: [...page.entries], first: boundary(page.entries[0]!), last: boundary(page.entries.at(-1)!) }
    }
    if (page.children.length > INTERNAL_MAX || page.children.length < (isRoot ? 2 : INTERNAL_MIN)) throw new Error("COW internal geometry is invalid")
    const entries: RemoteIngressEvidenceMapLeafEntryV2[] = []
    let prior: BoundaryV2 | null = null
    for (const child of page.children) {
      if (prior !== null && compareBoundary(prior, child.firstKey) >= 0) throw new Error("COW child boundaries are not canonical")
      const loaded = await this.#loadPage(child.childPageRecordDigest, expectedHeight - 1, false)
      if (compareBoundary(loaded.first, child.firstKey) !== 0 || compareBoundary(loaded.last, child.lastKey) !== 0 || String(loaded.entries.length) !== child.childSubtreeEntryCount) {
        throw new Error("COW child commitment mismatches")
      }
      entries.push(...loaded.entries)
      prior = child.lastKey
    }
    if (String(entries.length) !== page.subtreeEntryCount) throw new Error("COW internal subtree count mismatches")
    return { entries, first: boundary(entries[0]!), last: boundary(entries.at(-1)!) }
  }
}

function parseEntry(value: RemoteIngressEvidenceMapLeafEntryV2, projectId: ProjectIdV2, projectEpoch: Id128V2, mapKind: RemoteIngressEvidenceMapKindV2): RemoteIngressEvidenceMapLeafEntryV2 {
  if (!isObject(value) || value.mapKind !== mapKind) throw new Error("COW entry map kind is invalid")
  const keyDigest = parseDigestV2(value.keyDigest)
  const valueRecordDigest = parseDigestV2(value.valueRecordDigest)
  if (mapKind === "stable-key-state" && "stableKey" in value) {
    const stableKey = parseStableKey(value.stableKey as StableRemoteTransferKeyV2)
    if (stableKey.projectId !== projectId || stableKey.projectEpoch !== projectEpoch) throw new Error("COW stable key crosses Project epoch")
    return Object.freeze({ mapKind, keyDigest, stableKey, valueRecordDigest })
  }
  if (mapKind === "member-quota" && "sourceMemberId" in value) {
    return Object.freeze({ mapKind, keyDigest, sourceMemberId: parseMemberIdV2(value.sourceMemberId), valueRecordDigest })
  }
  throw new Error("COW entry discriminator is invalid")
}

function parseRoot(value: unknown, projectId: ProjectIdV2, projectEpoch: Id128V2, mapKind: RemoteIngressEvidenceMapKindV2): RemoteIngressEvidenceMapRootRecordV2 {
  assertKeys(value, ["entryCount", "format", "generation", "mapCommitment", "mapKind", "projectEpoch", "projectId", "rootPageDigest", "treeHeight"])
  const record = value as unknown as RemoteIngressEvidenceMapRootRecordV2
  if (record.format !== "convax.remote-ingress-evidence-map-root-record/2" || record.projectId !== projectId || record.projectEpoch !== projectEpoch || record.mapKind !== mapKind) throw new Error("COW root scope is invalid")
  parseUint64V2(record.generation); parseUint64V2(record.entryCount); parseUint32V2(record.treeHeight); parseDigestV2(record.mapCommitment)
  if (Number(record.treeHeight) > MAX_HEIGHT) throw new Error("COW root exceeds height 9")
  if (record.rootPageDigest !== null) parseDigestV2(record.rootPageDigest)
  const expectedCommitment = localDigest({ format: "convax.remote-ingress-evidence-map-commitment/2", projectId, projectEpoch, mapKind, rootPageDigest: record.rootPageDigest, entryCount: record.entryCount, treeHeight: record.treeHeight })
  if (record.mapCommitment !== expectedCommitment) throw new Error("COW root commitment mismatches")
  return Object.freeze(record)
}

function parsePage(value: unknown, projectId: ProjectIdV2, projectEpoch: Id128V2, mapKind: RemoteIngressEvidenceMapKindV2): PageV2 {
  if (!isObject(value)) throw new Error("COW page is invalid")
  if (value.format === "convax.remote-ingress-evidence-map-leaf-page-record/2") {
    assertKeys(value, ["entries", "format", "height", "mapKind", "projectEpoch", "projectId", "subtreeEntryCount"])
    const page = value as unknown as LeafPageV2
    if (page.projectId !== projectId || page.projectEpoch !== projectEpoch || page.mapKind !== mapKind || page.height !== "0" || !Array.isArray(page.entries)) throw new Error("COW leaf scope is invalid")
    const entries = page.entries.map((entry) => parseEntry(entry, projectId, projectEpoch, mapKind))
    if (entries.some((entry, index) => index > 0 && compareEntry(entries[index - 1]!, entry) >= 0)) throw new Error("COW leaf entries are not canonical")
    if (parseUint64V2(page.subtreeEntryCount) !== String(entries.length)) throw new Error("COW leaf subtree count mismatches")
    return Object.freeze({ ...page, entries: Object.freeze(entries) })
  }
  assertKeys(value, ["children", "format", "height", "mapKind", "projectEpoch", "projectId", "subtreeEntryCount"])
  const page = value as unknown as InternalPageV2
  if (page.format !== "convax.remote-ingress-evidence-map-internal-page-record/2" || page.projectId !== projectId || page.projectEpoch !== projectEpoch || page.mapKind !== mapKind || !Array.isArray(page.children)) throw new Error("COW internal scope is invalid")
  const height = parseUint32V2(page.height)
  if (height === "0" || Number(height) > MAX_HEIGHT) throw new Error("COW internal height is invalid")
  const children = page.children.map((child) => parseChild(child, projectId, projectEpoch, mapKind))
  const count = children.reduce((sum, child) => sum + BigInt(child.childSubtreeEntryCount), 0n)
  if (parseUint64V2(page.subtreeEntryCount) !== String(count)) throw new Error("COW internal count mismatches")
  return Object.freeze({ ...page, height, children: Object.freeze(children) })
}

function parseChild(value: unknown, projectId: ProjectIdV2, projectEpoch: Id128V2, mapKind: RemoteIngressEvidenceMapKindV2): ChildV2 {
  assertKeys(value, ["childPageRecordDigest", "childSubtreeEntryCount", "firstKey", "lastKey"])
  const child = value as unknown as ChildV2
  const firstKey = parseBoundary(child.firstKey, projectId, projectEpoch, mapKind)
  const lastKey = parseBoundary(child.lastKey, projectId, projectEpoch, mapKind)
  if (compareBoundary(firstKey, lastKey) > 0) throw new Error("COW child boundary is inverted")
  return Object.freeze({ firstKey, lastKey, childPageRecordDigest: parseDigestV2(child.childPageRecordDigest), childSubtreeEntryCount: parseUint64V2(child.childSubtreeEntryCount) })
}

function boundary(entry: RemoteIngressEvidenceMapLeafEntryV2): BoundaryV2 {
  return entry.mapKind === "stable-key-state"
    ? Object.freeze({ mapKind: entry.mapKind, keyDigest: entry.keyDigest, stableKey: entry.stableKey })
    : Object.freeze({ mapKind: entry.mapKind, keyDigest: entry.keyDigest, sourceMemberId: entry.sourceMemberId })
}

function parseBoundary(value: unknown, projectId: ProjectIdV2, projectEpoch: Id128V2, mapKind: RemoteIngressEvidenceMapKindV2): BoundaryV2 {
  if (!isObject(value) || value.mapKind !== mapKind) throw new Error("COW boundary kind is invalid")
  const keyDigest = parseDigestV2(value.keyDigest)
  if (mapKind === "stable-key-state" && "stableKey" in value) {
    const stableKey = parseStableKey(value.stableKey as StableRemoteTransferKeyV2)
    if (stableKey.projectId !== projectId || stableKey.projectEpoch !== projectEpoch) throw new Error("COW boundary crosses Project epoch")
    return Object.freeze({ mapKind, keyDigest, stableKey })
  }
  if (mapKind === "member-quota" && "sourceMemberId" in value) return Object.freeze({ mapKind, keyDigest, sourceMemberId: parseMemberIdV2(value.sourceMemberId) })
  throw new Error("COW boundary discriminator is invalid")
}

function compareEntry(left: RemoteIngressEvidenceMapLeafEntryV2, right: RemoteIngressEvidenceMapLeafEntryV2): number {
  return compareBoundary(boundary(left), boundary(right))
}

function compareBoundary(left: BoundaryV2, right: BoundaryV2): number {
  return Buffer.compare(Buffer.from(encodeRestrictedJcsV2(left)), Buffer.from(encodeRestrictedJcsV2(right)))
}

function distribute<T>(values: readonly T[], maximum: number, minimum: number): T[][] {
  if (values.length <= maximum) return [[...values]]
  const groups = Math.ceil(values.length / maximum)
  const base = Math.floor(values.length / groups)
  if (base < minimum) throw new Error("COW geometry cannot satisfy its non-root minimum")
  const extra = values.length % groups
  const result: T[][] = []
  let offset = 0
  for (let index = 0; index < groups; index += 1) {
    const size = base + (index >= groups - extra ? 1 : 0)
    result.push(values.slice(offset, offset + size))
    offset += size
  }
  return result
}

function parseStableKey(value: StableRemoteTransferKeyV2): StableRemoteTransferKeyV2 {
  assertKeys(value, ["projectEpoch", "projectId", "sourceMemberId", "transferId"])
  return Object.freeze({ projectId: parseProjectIdV2(value.projectId), projectEpoch: parseId128V2(value.projectEpoch), sourceMemberId: parseMemberIdV2(value.sourceMemberId), transferId: parseId128V2(value.transferId) })
}

function parseMapKind(value: unknown): RemoteIngressEvidenceMapKindV2 {
  if (value !== "stable-key-state" && value !== "member-quota") throw new TypeError("Remote ingress map kind is invalid")
  return value
}

function localDigest<T extends { readonly format: string }>(value: T): DigestV2 {
  const hash = createHash("sha256")
  hash.update("convax.local-project-store-record-digest/2\0")
  hash.update(encodeRestrictedJcsV2(value))
  return parseDigestV2(hash.digest("hex"))
}

async function putImmutable(directory: string, kind: string, digest: DigestV2, bytes: Uint8Array): Promise<void> {
  const target = path.join(directory, `${deriveObjectNativeKeyV2(kind, digest)}.bin`)
  const existing = await fs.readFile(target).catch((error) => isEnoent(error) ? null : Promise.reject(error))
  if (existing !== null) {
    if (!Buffer.from(existing).equals(Buffer.from(bytes))) throw new Error("Immutable COW object equivocation")
    return
  }
  const temporary = path.join(directory, `.${path.basename(target)}.${randomUUID()}.tmp`)
  const handle = await fs.open(temporary, "wx", 0o600)
  try { await handle.writeFile(bytes); await handle.sync() } finally { await handle.close() }
  try { await fs.link(temporary, target) } catch (error) {
    if (!isEexist(error)) throw error
    const winner = await fs.readFile(target)
    if (!Buffer.from(winner).equals(Buffer.from(bytes))) throw new Error("Immutable COW object equivocation")
  } finally { await fs.unlink(temporary).catch(() => undefined) }
  await fsyncDirectory(directory)
}

async function readImmutable(directory: string, kind: string, digest: DigestV2): Promise<Uint8Array> {
  const target = path.join(directory, `${deriveObjectNativeKeyV2(kind, digest)}.bin`)
  const stat = await fs.lstat(target)
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("COW object is not a regular file")
  return Uint8Array.from(await fs.readFile(target))
}

async function ensureRealDirectory(directory: string): Promise<void> {
  await fs.mkdir(directory, { recursive: true, mode: 0o700 })
  const stat = await fs.lstat(directory)
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("COW directory is untrusted")
}

async function fsyncDirectory(directory: string) {
  if (process.platform === "win32") return
  const handle = await fs.open(directory, "r")
  try { await handle.sync() } finally { await handle.close() }
}

function assertKeys(value: unknown, expected: readonly string[]): asserts value is Record<string, unknown> {
  if (!isObject(value)) throw new Error("COW record is invalid")
  const keys = Object.keys(value).sort()
  const sorted = [...expected].sort()
  if (keys.length !== sorted.length || keys.some((key, index) => key !== sorted[index])) throw new Error("COW record keys are invalid")
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype
}

function isEnoent(error: unknown): boolean { return isNodeError(error) && error.code === "ENOENT" }
function isEexist(error: unknown): boolean { return isNodeError(error) && error.code === "EEXIST" }
function isNodeError(error: unknown): error is NodeJS.ErrnoException { return error instanceof Error && "code" in error }
