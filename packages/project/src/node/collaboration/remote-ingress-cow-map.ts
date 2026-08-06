import { createHash, randomUUID } from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"
import {
  decodeRestrictedJcs,
  encodeRestrictedJcs,
  parseDigest,
  parseId128,
  parseMemberId,
  parseProjectId,
  parseUint32,
  parseUint64,
  type Digest,
  type Id128,
  type MemberId,
  type ProjectId,
  type StableRemoteTransferKey,
  type Uint32,
  type Uint64,
} from "@convax/collaboration"
import { deriveObjectNativeKey } from "./native-store-keys"
import { fsyncProjectDirectory } from "./directory-durability"

export type RemoteIngressEvidenceMapKind = "stable-key-state" | "member-quota"

export type RemoteIngressEvidenceMapLeafEntry =
  | Readonly<{
      mapKind: "stable-key-state"
      keyDigest: Digest
      stableKey: StableRemoteTransferKey
      valueRecordDigest: Digest
    }>
  | Readonly<{
      mapKind: "member-quota"
      keyDigest: Digest
      sourceMemberId: MemberId
      valueRecordDigest: Digest
    }>

export interface RemoteIngressEvidenceMapRootRecord {
  readonly format: "convax.remote-ingress-evidence-map-root-record"
  readonly projectId: ProjectId
  readonly projectEpoch: Id128
  readonly mapKind: RemoteIngressEvidenceMapKind
  readonly generation: Uint64
  readonly rootPageDigest: Digest | null
  readonly entryCount: Uint64
  readonly treeHeight: Uint32
  readonly mapCommitment: Digest
}

type Boundary =
  | Readonly<{ mapKind: "stable-key-state"; keyDigest: Digest; stableKey: StableRemoteTransferKey }>
  | Readonly<{ mapKind: "member-quota"; keyDigest: Digest; sourceMemberId: MemberId }>

interface Child {
  readonly firstKey: Boundary
  readonly lastKey: Boundary
  readonly childPageRecordDigest: Digest
  readonly childSubtreeEntryCount: Uint64
}

interface LeafPage {
  readonly format: "convax.remote-ingress-evidence-map-leaf-page-record"
  readonly projectId: ProjectId
  readonly projectEpoch: Id128
  readonly mapKind: RemoteIngressEvidenceMapKind
  readonly height: "0"
  readonly entries: readonly RemoteIngressEvidenceMapLeafEntry[]
  readonly subtreeEntryCount: Uint64
}

interface InternalPage {
  readonly format: "convax.remote-ingress-evidence-map-internal-page-record"
  readonly projectId: ProjectId
  readonly projectEpoch: Id128
  readonly mapKind: RemoteIngressEvidenceMapKind
  readonly height: Uint32
  readonly children: readonly Child[]
  readonly subtreeEntryCount: Uint64
}

type Page = LeafPage | InternalPage

interface BuiltPage {
  readonly digest: Digest
  readonly first: Boundary
  readonly last: Boundary
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
export class ProjectRemoteIngressCowMap {
  readonly #projectId: ProjectId
  readonly #projectEpoch: Id128
  readonly #mapKind: RemoteIngressEvidenceMapKind
  readonly #pages: string
  readonly #roots: string

  private constructor(input: {
    projectId: ProjectId
    projectEpoch: Id128
    mapKind: RemoteIngressEvidenceMapKind
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
    readonly projectId: ProjectId
    readonly projectEpoch: Id128
    readonly mapKind: RemoteIngressEvidenceMapKind
  }): Promise<ProjectRemoteIngressCowMap> {
    if (!path.isAbsolute(input.admissionDirectory)) throw new TypeError("Admission directory must be absolute")
    const projectId = parseProjectId(input.projectId)
    const projectEpoch = parseId128(input.projectEpoch)
    const mapKind = parseMapKind(input.mapKind)
    const root = path.join(input.admissionDirectory, "maps", mapKind)
    const pages = path.join(root, "pages")
    const roots = path.join(root, "roots")
    await ensureRealDirectory(pages)
    await ensureRealDirectory(roots)
    return new ProjectRemoteIngressCowMap({ projectId, projectEpoch, mapKind, pages, roots })
  }

  async publish(
    inputEntries: readonly RemoteIngressEvidenceMapLeafEntry[],
    generationInput: Uint64,
  ): Promise<Readonly<{ record: RemoteIngressEvidenceMapRootRecord; digest: Digest }>> {
    const generation = parseUint64(generationInput)
    const entries = inputEntries.map((entry) => parseEntry(entry, this.#projectId, this.#projectEpoch, this.#mapKind))
      .sort(compareEntry)
    for (let index = 1; index < entries.length; index += 1) {
      if (compareEntry(entries[index - 1]!, entries[index]!) === 0) throw new Error("COW map contains a duplicate canonical key")
    }
    let level: BuiltPage[] = []
    if (entries.length > 0) {
      for (const group of distribute(entries, LEAF_MAX, LEAF_MIN)) {
        const page: LeafPage = Object.freeze({
          format: "convax.remote-ingress-evidence-map-leaf-page-record",
          projectId: this.#projectId,
          projectEpoch: this.#projectEpoch,
          mapKind: this.#mapKind,
          height: "0",
          entries: Object.freeze(group),
          subtreeEntryCount: String(group.length) as Uint64,
        })
        const digest = await this.#putPage(page)
        level.push({ digest, first: boundary(group[0]!), last: boundary(group.at(-1)!), count: BigInt(group.length), height: 0 })
      }
      while (level.length > 1) {
        if (level[0]!.height >= MAX_HEIGHT) throw new Error("COW map exceeds height 9")
        const next: BuiltPage[] = []
        for (const group of distribute(level, INTERNAL_MAX, INTERNAL_MIN)) {
          const children = group.map((child): Child => Object.freeze({
            firstKey: child.first,
            lastKey: child.last,
            childPageRecordDigest: child.digest,
            childSubtreeEntryCount: String(child.count) as Uint64,
          }))
          const count = group.reduce((sum, child) => sum + child.count, 0n)
          const height = group[0]!.height + 1
          const page: InternalPage = Object.freeze({
            format: "convax.remote-ingress-evidence-map-internal-page-record",
            projectId: this.#projectId,
            projectEpoch: this.#projectEpoch,
            mapKind: this.#mapKind,
            height: String(height) as Uint32,
            children: Object.freeze(children),
            subtreeEntryCount: String(count) as Uint64,
          })
          const digest = await this.#putPage(page)
          next.push({ digest, first: group[0]!.first, last: group.at(-1)!.last, count, height })
        }
        level = next
      }
    }
    const rootPageDigest = level[0]?.digest ?? null
    const treeHeight = String(level[0]?.height ?? 0) as Uint32
    const entryCount = String(entries.length) as Uint64
    const mapCommitment = localDigest({
      format: "convax.remote-ingress-evidence-map-commitment",
      projectId: this.#projectId,
      projectEpoch: this.#projectEpoch,
      mapKind: this.#mapKind,
      rootPageDigest,
      entryCount,
      treeHeight,
    })
    const record: RemoteIngressEvidenceMapRootRecord = Object.freeze({
      format: "convax.remote-ingress-evidence-map-root-record",
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
    await putImmutable(this.#roots, "remote-ingress-map-root", digest, encodeRestrictedJcs(record))
    return Object.freeze({ record, digest })
  }

  async load(rootDigestInput: Digest): Promise<Readonly<{
    record: RemoteIngressEvidenceMapRootRecord
    entries: readonly RemoteIngressEvidenceMapLeafEntry[]
  }>> {
    const rootDigest = parseDigest(rootDigestInput)
    const record = parseRoot(
      decodeRestrictedJcs(await readImmutable(this.#roots, "remote-ingress-map-root", rootDigest)),
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

  async #putPage(page: Page): Promise<Digest> {
    const bytes = encodeRestrictedJcs(page)
    if (bytes.byteLength > MAX_PAGE_BYTES) throw new Error("COW page exceeds 65,536 bytes")
    const digest = localDigest(page)
    await putImmutable(this.#pages, "remote-ingress-map-page", digest, bytes)
    return digest
  }

  async #loadPage(digest: Digest, expectedHeight: number, isRoot: boolean): Promise<{ entries: RemoteIngressEvidenceMapLeafEntry[]; first: Boundary; last: Boundary }> {
    const bytes = await readImmutable(this.#pages, "remote-ingress-map-page", digest)
    if (bytes.byteLength > MAX_PAGE_BYTES) throw new Error("COW page exceeds 65,536 bytes")
    const page = parsePage(decodeRestrictedJcs(bytes), this.#projectId, this.#projectEpoch, this.#mapKind)
    if (localDigest(page) !== digest) throw new Error("COW page digest mismatches its pointer")
    if (Number(page.height) !== expectedHeight) throw new Error("COW page height mismatches its parent")
    if (page.format === "convax.remote-ingress-evidence-map-leaf-page-record") {
      if (page.entries.length > LEAF_MAX || page.entries.length < (isRoot ? 1 : LEAF_MIN)) throw new Error("COW leaf geometry is invalid")
      return { entries: [...page.entries], first: boundary(page.entries[0]!), last: boundary(page.entries.at(-1)!) }
    }
    if (page.children.length > INTERNAL_MAX || page.children.length < (isRoot ? 2 : INTERNAL_MIN)) throw new Error("COW internal geometry is invalid")
    const entries: RemoteIngressEvidenceMapLeafEntry[] = []
    let prior: Boundary | null = null
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

function parseEntry(value: RemoteIngressEvidenceMapLeafEntry, projectId: ProjectId, projectEpoch: Id128, mapKind: RemoteIngressEvidenceMapKind): RemoteIngressEvidenceMapLeafEntry {
  if (!isObject(value) || value.mapKind !== mapKind) throw new Error("COW entry map kind is invalid")
  const keyDigest = parseDigest(value.keyDigest)
  const valueRecordDigest = parseDigest(value.valueRecordDigest)
  if (mapKind === "stable-key-state" && "stableKey" in value) {
    const stableKey = parseStableKey(value.stableKey as StableRemoteTransferKey)
    if (stableKey.projectId !== projectId || stableKey.projectEpoch !== projectEpoch) throw new Error("COW stable key crosses Project epoch")
    return Object.freeze({ mapKind, keyDigest, stableKey, valueRecordDigest })
  }
  if (mapKind === "member-quota" && "sourceMemberId" in value) {
    return Object.freeze({ mapKind, keyDigest, sourceMemberId: parseMemberId(value.sourceMemberId), valueRecordDigest })
  }
  throw new Error("COW entry discriminator is invalid")
}

function parseRoot(value: unknown, projectId: ProjectId, projectEpoch: Id128, mapKind: RemoteIngressEvidenceMapKind): RemoteIngressEvidenceMapRootRecord {
  assertKeys(value, ["entryCount", "format", "generation", "mapCommitment", "mapKind", "projectEpoch", "projectId", "rootPageDigest", "treeHeight"])
  const record = value as unknown as RemoteIngressEvidenceMapRootRecord
  if (record.format !== "convax.remote-ingress-evidence-map-root-record" || record.projectId !== projectId || record.projectEpoch !== projectEpoch || record.mapKind !== mapKind) throw new Error("COW root scope is invalid")
  parseUint64(record.generation); parseUint64(record.entryCount); parseUint32(record.treeHeight); parseDigest(record.mapCommitment)
  if (Number(record.treeHeight) > MAX_HEIGHT) throw new Error("COW root exceeds height 9")
  if (record.rootPageDigest !== null) parseDigest(record.rootPageDigest)
  const expectedCommitment = localDigest({ format: "convax.remote-ingress-evidence-map-commitment", projectId, projectEpoch, mapKind, rootPageDigest: record.rootPageDigest, entryCount: record.entryCount, treeHeight: record.treeHeight })
  if (record.mapCommitment !== expectedCommitment) throw new Error("COW root commitment mismatches")
  return Object.freeze(record)
}

function parsePage(value: unknown, projectId: ProjectId, projectEpoch: Id128, mapKind: RemoteIngressEvidenceMapKind): Page {
  if (!isObject(value)) throw new Error("COW page is invalid")
  if (value.format === "convax.remote-ingress-evidence-map-leaf-page-record") {
    assertKeys(value, ["entries", "format", "height", "mapKind", "projectEpoch", "projectId", "subtreeEntryCount"])
    const page = value as unknown as LeafPage
    if (page.projectId !== projectId || page.projectEpoch !== projectEpoch || page.mapKind !== mapKind || page.height !== "0" || !Array.isArray(page.entries)) throw new Error("COW leaf scope is invalid")
    const entries = page.entries.map((entry) => parseEntry(entry, projectId, projectEpoch, mapKind))
    if (entries.some((entry, index) => index > 0 && compareEntry(entries[index - 1]!, entry) >= 0)) throw new Error("COW leaf entries are not canonical")
    if (parseUint64(page.subtreeEntryCount) !== String(entries.length)) throw new Error("COW leaf subtree count mismatches")
    return Object.freeze({ ...page, entries: Object.freeze(entries) })
  }
  assertKeys(value, ["children", "format", "height", "mapKind", "projectEpoch", "projectId", "subtreeEntryCount"])
  const page = value as unknown as InternalPage
  if (page.format !== "convax.remote-ingress-evidence-map-internal-page-record" || page.projectId !== projectId || page.projectEpoch !== projectEpoch || page.mapKind !== mapKind || !Array.isArray(page.children)) throw new Error("COW internal scope is invalid")
  const height = parseUint32(page.height)
  if (height === "0" || Number(height) > MAX_HEIGHT) throw new Error("COW internal height is invalid")
  const children = page.children.map((child) => parseChild(child, projectId, projectEpoch, mapKind))
  const count = children.reduce((sum, child) => sum + BigInt(child.childSubtreeEntryCount), 0n)
  if (parseUint64(page.subtreeEntryCount) !== String(count)) throw new Error("COW internal count mismatches")
  return Object.freeze({ ...page, height, children: Object.freeze(children) })
}

function parseChild(value: unknown, projectId: ProjectId, projectEpoch: Id128, mapKind: RemoteIngressEvidenceMapKind): Child {
  assertKeys(value, ["childPageRecordDigest", "childSubtreeEntryCount", "firstKey", "lastKey"])
  const child = value as unknown as Child
  const firstKey = parseBoundary(child.firstKey, projectId, projectEpoch, mapKind)
  const lastKey = parseBoundary(child.lastKey, projectId, projectEpoch, mapKind)
  if (compareBoundary(firstKey, lastKey) > 0) throw new Error("COW child boundary is inverted")
  return Object.freeze({ firstKey, lastKey, childPageRecordDigest: parseDigest(child.childPageRecordDigest), childSubtreeEntryCount: parseUint64(child.childSubtreeEntryCount) })
}

function boundary(entry: RemoteIngressEvidenceMapLeafEntry): Boundary {
  return entry.mapKind === "stable-key-state"
    ? Object.freeze({ mapKind: entry.mapKind, keyDigest: entry.keyDigest, stableKey: entry.stableKey })
    : Object.freeze({ mapKind: entry.mapKind, keyDigest: entry.keyDigest, sourceMemberId: entry.sourceMemberId })
}

function parseBoundary(value: unknown, projectId: ProjectId, projectEpoch: Id128, mapKind: RemoteIngressEvidenceMapKind): Boundary {
  if (!isObject(value) || value.mapKind !== mapKind) throw new Error("COW boundary kind is invalid")
  const keyDigest = parseDigest(value.keyDigest)
  if (mapKind === "stable-key-state" && "stableKey" in value) {
    const stableKey = parseStableKey(value.stableKey as StableRemoteTransferKey)
    if (stableKey.projectId !== projectId || stableKey.projectEpoch !== projectEpoch) throw new Error("COW boundary crosses Project epoch")
    return Object.freeze({ mapKind, keyDigest, stableKey })
  }
  if (mapKind === "member-quota" && "sourceMemberId" in value) return Object.freeze({ mapKind, keyDigest, sourceMemberId: parseMemberId(value.sourceMemberId) })
  throw new Error("COW boundary discriminator is invalid")
}

function compareEntry(left: RemoteIngressEvidenceMapLeafEntry, right: RemoteIngressEvidenceMapLeafEntry): number {
  return compareBoundary(boundary(left), boundary(right))
}

function compareBoundary(left: Boundary, right: Boundary): number {
  return Buffer.compare(Buffer.from(encodeRestrictedJcs(left)), Buffer.from(encodeRestrictedJcs(right)))
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

function parseStableKey(value: StableRemoteTransferKey): StableRemoteTransferKey {
  assertKeys(value, ["projectEpoch", "projectId", "sourceMemberId", "transferId"])
  return Object.freeze({ projectId: parseProjectId(value.projectId), projectEpoch: parseId128(value.projectEpoch), sourceMemberId: parseMemberId(value.sourceMemberId), transferId: parseId128(value.transferId) })
}

function parseMapKind(value: unknown): RemoteIngressEvidenceMapKind {
  if (value !== "stable-key-state" && value !== "member-quota") throw new TypeError("Remote ingress map kind is invalid")
  return value
}

function localDigest<T extends { readonly format: string }>(value: T): Digest {
  const hash = createHash("sha256")
  hash.update("convax.local-project-store-record-digest\0")
  hash.update(encodeRestrictedJcs(value))
  return parseDigest(hash.digest("hex"))
}

async function putImmutable(directory: string, kind: string, digest: Digest, bytes: Uint8Array): Promise<void> {
  const target = path.join(directory, `${deriveObjectNativeKey(kind, digest)}.bin`)
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
  await fsyncProjectDirectory(directory)
}

async function readImmutable(directory: string, kind: string, digest: Digest): Promise<Uint8Array> {
  const target = path.join(directory, `${deriveObjectNativeKey(kind, digest)}.bin`)
  const stat = await fs.lstat(target)
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("COW object is not a regular file")
  return Uint8Array.from(await fs.readFile(target))
}

async function ensureRealDirectory(directory: string): Promise<void> {
  await fs.mkdir(directory, { recursive: true, mode: 0o700 })
  const stat = await fs.lstat(directory)
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("COW directory is untrusted")
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
