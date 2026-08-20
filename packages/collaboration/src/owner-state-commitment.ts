import { parseDigest, type Digest } from "./codecs"
import type { DocumentOwnerKind } from "./contracts"
import { KERNEL_DIGEST_DOMAINS } from "./constants"
import { CollaborationCodecError } from "./errors"
import {
  assertDenseArray,
  assertExactKeys,
  assertNfcScalarString,
  compareUtf8,
  decodeRestrictedJcs,
  encodeRestrictedJcs,
  utf8ByteLength,
} from "./jcs"
import { structuredDigest } from "./digest"

export const OWNER_STATE_COMMITMENT_CODEC = "sha256-merkle-patricia-v1" as const
export const OWNER_STATE_CANONICAL_KEY_PATH_POLICY = "nfc-utf8-no-nul-bounded-v1" as const
export const OWNER_STATE_MAX_CANONICAL_NAME_UTF8_BYTES = "128" as const
export const OWNER_STATE_MAX_CANONICAL_KEY_UTF8_BYTES = "1024" as const

const MAX_SCALAR_NAMES = 256
const MAX_COLLECTION_NAMES = 64
const MAX_COLLECTION_ENTRIES = 1_000_000
const MAX_MUTATIONS = 2_048
const encoder = new TextEncoder()

declare const ownerStateCommitmentBrand: unique symbol

/** Opaque, process-local root of one exact owner canonical state. */
export interface OwnerStateCommitment {
  readonly [ownerStateCommitmentBrand]: true
}

/**
 * Exact schema-owned layout committed by the current owner canonicalizer.
 * Names are a closed, UTF-8-sorted set. They are not inferred from canonical
 * bytes, a cache, or the current contents of a Y.Doc.
 */
export interface OwnerStateCommitmentDescriptor {
  readonly format: "convax.owner-state-commitment-descriptor"
  readonly commitmentCodec: typeof OWNER_STATE_COMMITMENT_CODEC
  readonly canonicalKeyPathPolicy: typeof OWNER_STATE_CANONICAL_KEY_PATH_POLICY
  readonly maxCanonicalNameUtf8Bytes: typeof OWNER_STATE_MAX_CANONICAL_NAME_UTF8_BYTES
  readonly maxCanonicalKeyUtf8Bytes: typeof OWNER_STATE_MAX_CANONICAL_KEY_UTF8_BYTES
  readonly scalarNames: readonly string[]
  readonly collectionNames: readonly string[]
}

export interface OwnerStateCommitmentSource {
  readonly descriptor: OwnerStateCommitmentDescriptor
  readonly scalars: readonly Readonly<{ readonly name: string; readonly value: unknown }>[]
  readonly collections: readonly Readonly<{
    readonly name: string
    readonly entries: readonly Readonly<{ readonly key: string; readonly value: unknown }>[]
  }>[]
}

export type OwnerStateCommitmentMutation =
  | Readonly<{ readonly kind: "set-scalar"; readonly name: string; readonly value: unknown }>
  | Readonly<{ readonly kind: "set"; readonly collection: string; readonly key: string; readonly value: unknown }>
  | Readonly<{ readonly kind: "delete"; readonly collection: string; readonly key: string }>

/**
 * Selected-owner-only capability. A commitment from another runtime, owner, or
 * schema is rejected even when its public shape and digest are copied.
 */
export interface OwnerStateCommitmentIssuer {
  build(input: OwnerStateCommitmentSource): OwnerStateCommitment
  apply(
    base: OwnerStateCommitment,
    mutations: readonly OwnerStateCommitmentMutation[],
  ): OwnerStateCommitment
  digest(commitment: OwnerStateCommitment): Digest
}

export interface OwnerStateCommitmentWork {
  readonly entryCount: number
  readonly nodeCount: number
  readonly leafHashCount: number
  readonly nodeHashCount: number
  readonly pathCopyCount: number
  readonly visitedKeyBytes: number
  readonly valueJcsBytes: number
}

interface Leaf {
  readonly key: string
  readonly digest: Digest
}

interface RadixChild {
  readonly edge: number
  readonly node: RadixNode
}

interface RadixNode {
  readonly prefix: Uint8Array
  readonly value: Leaf | null
  readonly children: readonly RadixChild[]
  readonly digest: Digest
  readonly entryCount: number
  readonly nodeCount: number
}

interface CollectionState {
  readonly name: string
  readonly root: RadixNode | null
  readonly digest: Digest
}

interface CommitmentRecord {
  readonly issuerIdentity: object
  readonly owner: DocumentOwnerKind
  readonly ownerSchemaDigest: Digest
  readonly descriptor: OwnerStateCommitmentDescriptor
  readonly descriptorDigest: Digest
  readonly scalars: ReadonlyMap<string, Digest>
  readonly collections: ReadonlyMap<string, CollectionState>
  readonly rootDigest: Digest
  readonly work: OwnerStateCommitmentWork
}

interface WorkCounter {
  leafHashCount: number
  nodeHashCount: number
  pathCopyCount: number
  visitedKeyBytes: number
  valueJcsBytes: number
}

const liveCommitments = new WeakMap<object, CommitmentRecord>()
const liveIssuers = new WeakMap<object, Readonly<{
  readonly identity: object
  readonly owner: DocumentOwnerKind
  readonly ownerSchemaDigest: Digest
}>>()

export function parseOwnerStateCommitmentDescriptor(value: unknown): OwnerStateCommitmentDescriptor {
  const normalized = decodeRestrictedJcs(encodeRestrictedJcs(value))
  assertExactKeys(normalized, [
    "format",
    "commitmentCodec",
    "canonicalKeyPathPolicy",
    "maxCanonicalNameUtf8Bytes",
    "maxCanonicalKeyUtf8Bytes",
    "scalarNames",
    "collectionNames",
  ], "OwnerStateCommitmentDescriptor")
  if (
    normalized.format !== "convax.owner-state-commitment-descriptor" ||
    normalized.commitmentCodec !== OWNER_STATE_COMMITMENT_CODEC ||
    normalized.canonicalKeyPathPolicy !== OWNER_STATE_CANONICAL_KEY_PATH_POLICY ||
    normalized.maxCanonicalNameUtf8Bytes !== OWNER_STATE_MAX_CANONICAL_NAME_UTF8_BYTES ||
    normalized.maxCanonicalKeyUtf8Bytes !== OWNER_STATE_MAX_CANONICAL_KEY_UTF8_BYTES
  ) {
    invalid("Owner state commitment descriptor policy is invalid")
  }
  const scalarNames = parseCanonicalNames(normalized.scalarNames, "scalar", MAX_SCALAR_NAMES)
  const collectionNames = parseCanonicalNames(normalized.collectionNames, "collection", MAX_COLLECTION_NAMES)
  const allNames = new Set(scalarNames)
  for (const name of collectionNames) {
    if (allNames.has(name)) invalid("Owner state commitment scalar and collection names overlap")
    allNames.add(name)
  }
  return Object.freeze({
    format: normalized.format,
    commitmentCodec: normalized.commitmentCodec,
    canonicalKeyPathPolicy: normalized.canonicalKeyPathPolicy,
    maxCanonicalNameUtf8Bytes: normalized.maxCanonicalNameUtf8Bytes,
    maxCanonicalKeyUtf8Bytes: normalized.maxCanonicalKeyUtf8Bytes,
    scalarNames,
    collectionNames,
  })
}

export function ownerStateCommitmentDescriptorDigest(
  value: OwnerStateCommitmentDescriptor | unknown,
): Digest {
  return structuredDigest(
    KERNEL_DIGEST_DOMAINS.ownerStateCommitmentDescriptor,
    parseOwnerStateCommitmentDescriptor(value),
  )
}

/** Selected-owner factory seam. The package root deliberately does not export it. */
export function createOwnerStateCommitmentIssuer(input: Readonly<{
  readonly owner: DocumentOwnerKind
  readonly ownerSchemaDigest: Digest
}>): OwnerStateCommitmentIssuer {
  if (input.owner !== "canvas" && input.owner !== "project-index") invalid("Owner state commitment owner is invalid")
  const ownerSchemaDigest = parseDigest(input.ownerSchemaDigest)
  const identity = Object.freeze({})

  const issuer = Object.freeze({
    build(source: OwnerStateCommitmentSource): OwnerStateCommitment {
      const descriptor = parseOwnerStateCommitmentDescriptor(source.descriptor)
      const descriptorDigest = ownerStateCommitmentDescriptorDigest(descriptor)
      const work = emptyWork()
      const scalars = buildScalars(input.owner, ownerSchemaDigest, descriptor, descriptorDigest, source.scalars, work)
      const collections = buildCollections(
        input.owner,
        ownerSchemaDigest,
        descriptor,
        descriptorDigest,
        source.collections,
        work,
      )
      return issueCommitment({
        issuerIdentity: identity,
        owner: input.owner,
        ownerSchemaDigest,
        descriptor,
        descriptorDigest,
        scalars,
        collections,
        rootDigest: ownerRootDigest(input.owner, ownerSchemaDigest, descriptor, descriptorDigest, scalars, collections),
        work: finishWork(work, collections),
      })
    },

    apply(
      base: OwnerStateCommitment,
      mutations: readonly OwnerStateCommitmentMutation[],
    ): OwnerStateCommitment {
      const record = requireOwnCommitment(identity, base)
      requireDenseBoundedArray(mutations, MAX_MUTATIONS, "Owner state commitment mutations")
      const work = emptyWork()
      let scalars = record.scalars
      let collections = record.collections
      const changedScalars = new Set<string>()
      const changedEntries = new Set<string>()

      for (const mutation of mutations) {
        if (typeof mutation !== "object" || mutation === null) invalid("Owner state commitment mutation is invalid")
        if (mutation.kind === "set-scalar") {
          assertExactKeys(mutation, ["kind", "name", "value"], "Owner scalar commitment mutation")
          const name = requireDeclaredName(mutation.name, record.descriptor.scalarNames, "scalar")
          if (changedScalars.has(name)) invalid("Owner state commitment repeats one scalar mutation")
          changedScalars.add(name)
          const digest = scalarLeafDigest(
            record.owner,
            record.ownerSchemaDigest,
            record.descriptor,
            record.descriptorDigest,
            name,
            mutation.value,
            work,
          )
          const next = new Map(scalars)
          next.set(name, digest)
          scalars = next
          continue
        }
        if (mutation.kind !== "set" && mutation.kind !== "delete") {
          invalid("Owner state commitment mutation kind is invalid")
        }
        assertExactKeys(
          mutation,
          mutation.kind === "set" ? ["kind", "collection", "key", "value"] : ["kind", "collection", "key"],
          "Owner collection commitment mutation",
        )
        const collectionName = requireDeclaredName(mutation.collection, record.descriptor.collectionNames, "collection")
        const key = parseCanonicalKey(mutation.key)
        const mutationIdentity = `${collectionName}\u0000${key}`
        if (changedEntries.has(mutationIdentity)) invalid("Owner state commitment repeats one collection-key mutation")
        changedEntries.add(mutationIdentity)
        const current = collections.get(collectionName)
        if (!current) invalid("Owner state commitment collection is missing")
        const keyBytes = encoder.encode(key)
        work.visitedKeyBytes += keyBytes.byteLength
        const root = mutation.kind === "set"
          ? setRadix(
              current.root,
              keyBytes,
              0,
              collectionLeaf(
                record.owner,
                record.ownerSchemaDigest,
                record.descriptor,
                record.descriptorDigest,
                collectionName,
                key,
                mutation.value,
                work,
              ),
              record,
              collectionName,
              work,
            )
          : deleteRadix(current.root, keyBytes, 0, record, collectionName, work)
        const next = new Map(collections)
        next.set(collectionName, collectionState(record, collectionName, root))
        collections = next
      }

      return issueCommitment({
        ...record,
        scalars,
        collections,
        rootDigest: ownerRootDigest(
          record.owner,
          record.ownerSchemaDigest,
          record.descriptor,
          record.descriptorDigest,
          scalars,
          collections,
        ),
        work: finishWork(work, collections),
      })
    },

    digest(commitment: OwnerStateCommitment): Digest {
      return requireOwnCommitment(identity, commitment).rootDigest
    },
  }) satisfies OwnerStateCommitmentIssuer
  liveIssuers.set(issuer, Object.freeze({ identity, owner: input.owner, ownerSchemaDigest }))
  return issuer
}

/** Test-only structural metrics; not exported by the package root. */
export function testOnlyOwnerStateCommitmentWork(
  issuer: OwnerStateCommitmentIssuer,
  commitment: OwnerStateCommitment,
): OwnerStateCommitmentWork {
  const issuerRecord = liveIssuers.get(issuer as object)
  if (!issuerRecord) invalid("Owner state commitment issuer is structural")
  return requireOwnCommitment(issuerRecord.identity, commitment).work
}

/** Internal owner-runtime verifier; not exported by the package root. */
export function inspectOwnerStateCommitment(
  issuer: OwnerStateCommitmentIssuer,
  commitment: OwnerStateCommitment,
): Readonly<{
  readonly owner: DocumentOwnerKind
  readonly ownerSchemaDigest: Digest
  readonly descriptorDigest: Digest
  readonly rootDigest: Digest
}> | null {
  try {
    const issuerRecord = liveIssuers.get(issuer as object)
    if (!issuerRecord) return null
    const record = requireOwnCommitment(issuerRecord.identity, commitment)
    return Object.freeze({
      owner: record.owner,
      ownerSchemaDigest: record.ownerSchemaDigest,
      descriptorDigest: record.descriptorDigest,
      rootDigest: record.rootDigest,
    })
  } catch {
    return null
  }
}

function buildScalars(
  owner: DocumentOwnerKind,
  ownerSchemaDigest: Digest,
  descriptor: OwnerStateCommitmentDescriptor,
  descriptorDigest: Digest,
  source: OwnerStateCommitmentSource["scalars"],
  work: WorkCounter,
): ReadonlyMap<string, Digest> {
  requireDenseBoundedArray(source, MAX_SCALAR_NAMES, "Owner state commitment scalars")
  const scalars = new Map<string, Digest>()
  for (const scalar of source) {
    assertExactKeys(scalar, ["name", "value"], "Owner state commitment scalar")
    const name = requireDeclaredName(scalar.name, descriptor.scalarNames, "scalar")
    if (scalars.has(name)) invalid("Owner state commitment has a duplicate scalar name")
    scalars.set(name, scalarLeafDigest(owner, ownerSchemaDigest, descriptor, descriptorDigest, name, scalar.value, work))
  }
  assertExactClosedNames(scalars, descriptor.scalarNames, "scalar")
  return scalars
}

function buildCollections(
  owner: DocumentOwnerKind,
  ownerSchemaDigest: Digest,
  descriptor: OwnerStateCommitmentDescriptor,
  descriptorDigest: Digest,
  source: OwnerStateCommitmentSource["collections"],
  work: WorkCounter,
): ReadonlyMap<string, CollectionState> {
  requireDenseBoundedArray(source, MAX_COLLECTION_NAMES, "Owner state commitment collections")
  const collections = new Map<string, CollectionState>()
  const record = { owner, ownerSchemaDigest, descriptor, descriptorDigest } as CommitmentRecord
  for (const collection of source) {
    assertExactKeys(collection, ["name", "entries"], "Owner state commitment collection")
    const name = requireDeclaredName(collection.name, descriptor.collectionNames, "collection")
    if (collections.has(name)) invalid("Owner state commitment has a duplicate collection name")
    requireDenseBoundedArray(collection.entries, MAX_COLLECTION_ENTRIES, "Owner state commitment collection entries")
    let root: RadixNode | null = null
    const seenKeys = new Set<string>()
    for (const entry of collection.entries) {
      assertExactKeys(entry, ["key", "value"], "Owner state commitment collection entry")
      const key = parseCanonicalKey(entry.key)
      if (seenKeys.has(key)) invalid("Owner state commitment has a duplicate collection key")
      seenKeys.add(key)
      const keyBytes = encoder.encode(key)
      work.visitedKeyBytes += keyBytes.byteLength
      root = setRadix(
        root,
        keyBytes,
        0,
        collectionLeaf(owner, ownerSchemaDigest, descriptor, descriptorDigest, name, key, entry.value, work),
        record,
        name,
        work,
      )
    }
    collections.set(name, collectionState(record, name, root))
  }
  assertExactClosedNames(collections, descriptor.collectionNames, "collection")
  return collections
}

function scalarLeafDigest(
  owner: DocumentOwnerKind,
  ownerSchemaDigest: Digest,
  descriptor: OwnerStateCommitmentDescriptor,
  descriptorDigest: Digest,
  name: string,
  value: unknown,
  work: WorkCounter,
): Digest {
  const exactValueJcs = encodeRestrictedJcs(value)
  work.leafHashCount += 1
  work.valueJcsBytes += exactValueJcs.byteLength
  return structuredDigest(KERNEL_DIGEST_DOMAINS.ownerStateCommitmentScalarLeaf, {
    format: "convax.owner-state-commitment-scalar-leaf",
    owner,
    ownerSchemaDigest,
    commitmentCodec: descriptor.commitmentCodec,
    canonicalKeyPathPolicy: descriptor.canonicalKeyPathPolicy,
    descriptorDigest,
    name,
    value: decodeRestrictedJcs(exactValueJcs),
  })
}

function collectionLeaf(
  owner: DocumentOwnerKind,
  ownerSchemaDigest: Digest,
  descriptor: OwnerStateCommitmentDescriptor,
  descriptorDigest: Digest,
  collection: string,
  key: string,
  value: unknown,
  work: WorkCounter,
): Leaf {
  const exactValueJcs = encodeRestrictedJcs(value)
  work.leafHashCount += 1
  work.valueJcsBytes += exactValueJcs.byteLength
  return Object.freeze({
    key,
    digest: structuredDigest(KERNEL_DIGEST_DOMAINS.ownerStateCommitmentCollectionLeaf, {
      format: "convax.owner-state-commitment-collection-leaf",
      owner,
      ownerSchemaDigest,
      commitmentCodec: descriptor.commitmentCodec,
      canonicalKeyPathPolicy: descriptor.canonicalKeyPathPolicy,
      descriptorDigest,
      collection,
      key,
      value: decodeRestrictedJcs(exactValueJcs),
    }),
  })
}

function setRadix(
  node: RadixNode | null,
  path: Uint8Array,
  offset: number,
  leaf: Leaf,
  record: Pick<CommitmentRecord, "owner" | "ownerSchemaDigest" | "descriptor" | "descriptorDigest">,
  collection: string,
  work: WorkCounter,
): RadixNode {
  if (node === null) return makeNode(path.slice(offset), leaf, [], record, collection, work)
  const common = commonPrefixLength(node.prefix, path, offset)
  if (common < node.prefix.byteLength) {
    const oldEdge = node.prefix[common]!
    const oldChild = makeNode(
      node.prefix.slice(common + 1),
      node.value,
      node.children,
      record,
      collection,
      work,
    )
    const branchPrefix = node.prefix.slice(0, common)
    if (offset + common === path.byteLength) {
      return makeNode(branchPrefix, leaf, [{ edge: oldEdge, node: oldChild }], record, collection, work)
    }
    const newEdge = path[offset + common]!
    const newChild = makeNode(path.slice(offset + common + 1), leaf, [], record, collection, work)
    return makeNode(
      branchPrefix,
      null,
      sortChildren([{ edge: oldEdge, node: oldChild }, { edge: newEdge, node: newChild }]),
      record,
      collection,
      work,
    )
  }

  const nextOffset = offset + common
  if (nextOffset === path.byteLength) {
    if (node.value?.digest === leaf.digest && node.value.key === leaf.key) return node
    return makeNode(node.prefix, leaf, node.children, record, collection, work)
  }
  const edge = path[nextOffset]!
  const childIndex = findChild(node.children, edge)
  const child = childIndex < node.children.length && node.children[childIndex]?.edge === edge
    ? node.children[childIndex]!.node
    : null
  const updated = setRadix(child, path, nextOffset + 1, leaf, record, collection, work)
  if (updated === child) return node
  const children = [...node.children]
  if (child === null) children.splice(childIndex, 0, Object.freeze({ edge, node: updated }))
  else children[childIndex] = Object.freeze({ edge, node: updated })
  return makeNode(node.prefix, node.value, children, record, collection, work)
}

function deleteRadix(
  node: RadixNode | null,
  path: Uint8Array,
  offset: number,
  record: Pick<CommitmentRecord, "owner" | "ownerSchemaDigest" | "descriptor" | "descriptorDigest">,
  collection: string,
  work: WorkCounter,
): RadixNode | null {
  if (node === null) invalid("Owner state commitment cannot delete an absent key")
  const common = commonPrefixLength(node.prefix, path, offset)
  if (common !== node.prefix.byteLength) invalid("Owner state commitment cannot delete an absent key")
  const nextOffset = offset + common
  if (nextOffset === path.byteLength) {
    if (node.value === null) invalid("Owner state commitment cannot delete an absent key")
    return normalizeNode(node.prefix, null, node.children, record, collection, work)
  }
  const edge = path[nextOffset]!
  const childIndex = findChild(node.children, edge)
  if (childIndex >= node.children.length || node.children[childIndex]?.edge !== edge) {
    invalid("Owner state commitment cannot delete an absent key")
  }
  const updated = deleteRadix(node.children[childIndex]!.node, path, nextOffset + 1, record, collection, work)
  const children = [...node.children]
  if (updated === null) children.splice(childIndex, 1)
  else children[childIndex] = Object.freeze({ edge, node: updated })
  return normalizeNode(node.prefix, node.value, children, record, collection, work)
}

function normalizeNode(
  prefix: Uint8Array,
  value: Leaf | null,
  children: readonly RadixChild[],
  record: Pick<CommitmentRecord, "owner" | "ownerSchemaDigest" | "descriptor" | "descriptorDigest">,
  collection: string,
  work: WorkCounter,
): RadixNode | null {
  if (value === null && children.length === 0) return null
  if (value === null && children.length === 1) {
    const only = children[0]!
    const merged = new Uint8Array(prefix.byteLength + 1 + only.node.prefix.byteLength)
    merged.set(prefix)
    merged[prefix.byteLength] = only.edge
    merged.set(only.node.prefix, prefix.byteLength + 1)
    return makeNode(merged, only.node.value, only.node.children, record, collection, work)
  }
  return makeNode(prefix, value, children, record, collection, work)
}

function makeNode(
  prefix: Uint8Array,
  value: Leaf | null,
  children: readonly RadixChild[],
  record: Pick<CommitmentRecord, "owner" | "ownerSchemaDigest" | "descriptor" | "descriptorDigest">,
  collection: string,
  work: WorkCounter,
): RadixNode {
  if (children.length > 256) invalid("Owner state commitment radix node has too many children")
  let previous = -1
  let entryCount = value === null ? 0 : 1
  let nodeCount = 1
  const exactChildren = children.map((child) => {
    if (!Number.isInteger(child.edge) || child.edge < 0 || child.edge > 255 || child.edge <= previous) {
      invalid("Owner state commitment radix children are not uniquely byte-sorted")
    }
    previous = child.edge
    entryCount += child.node.entryCount
    nodeCount += child.node.nodeCount
    return Object.freeze({ edge: child.edge, node: child.node })
  })
  const exactPrefix = Uint8Array.from(prefix)
  work.nodeHashCount += 1
  work.pathCopyCount += 1
  const digest = structuredDigest(KERNEL_DIGEST_DOMAINS.ownerStateCommitmentRadixNode, {
    format: "convax.owner-state-commitment-radix-node",
    owner: record.owner,
    ownerSchemaDigest: record.ownerSchemaDigest,
    commitmentCodec: record.descriptor.commitmentCodec,
    canonicalKeyPathPolicy: record.descriptor.canonicalKeyPathPolicy,
    descriptorDigest: record.descriptorDigest,
    collection,
    prefixHex: byteStringHex(exactPrefix),
    valueDigest: value?.digest ?? null,
    children: exactChildren.map((child) => [String(child.edge), child.node.digest]),
  })
  return Object.freeze({
    prefix: exactPrefix,
    value,
    children: Object.freeze(exactChildren),
    digest,
    entryCount,
    nodeCount,
  })
}

function collectionState(
  record: Pick<CommitmentRecord, "owner" | "ownerSchemaDigest" | "descriptor" | "descriptorDigest">,
  name: string,
  root: RadixNode | null,
): CollectionState {
  return Object.freeze({
    name,
    root,
    digest: structuredDigest(KERNEL_DIGEST_DOMAINS.ownerStateCommitmentCollectionRoot, {
      format: "convax.owner-state-commitment-collection-root",
      owner: record.owner,
      ownerSchemaDigest: record.ownerSchemaDigest,
      commitmentCodec: record.descriptor.commitmentCodec,
      canonicalKeyPathPolicy: record.descriptor.canonicalKeyPathPolicy,
      descriptorDigest: record.descriptorDigest,
      collection: name,
      entryCount: String(root?.entryCount ?? 0),
      radixRootDigest: root?.digest ?? null,
    }),
  })
}

function ownerRootDigest(
  owner: DocumentOwnerKind,
  ownerSchemaDigest: Digest,
  descriptor: OwnerStateCommitmentDescriptor,
  descriptorDigest: Digest,
  scalars: ReadonlyMap<string, Digest>,
  collections: ReadonlyMap<string, CollectionState>,
): Digest {
  return structuredDigest(KERNEL_DIGEST_DOMAINS.ownerStateCommitmentRoot, {
    format: "convax.owner-state-commitment-root",
    owner,
    ownerSchemaDigest,
    commitmentCodec: descriptor.commitmentCodec,
    canonicalKeyPathPolicy: descriptor.canonicalKeyPathPolicy,
    maxCanonicalNameUtf8Bytes: descriptor.maxCanonicalNameUtf8Bytes,
    maxCanonicalKeyUtf8Bytes: descriptor.maxCanonicalKeyUtf8Bytes,
    descriptorDigest,
    scalars: descriptor.scalarNames.map((name) => [name, requireMapValue(scalars, name)]),
    collections: descriptor.collectionNames.map((name) => [name, requireMapValue(collections, name).digest]),
  })
}

function issueCommitment(record: CommitmentRecord): OwnerStateCommitment {
  const commitment = Object.freeze({}) as OwnerStateCommitment
  liveCommitments.set(commitment, Object.freeze(record))
  return commitment
}

function requireOwnCommitment(identity: object, value: OwnerStateCommitment): CommitmentRecord {
  const record = typeof value === "object" && value !== null ? liveCommitments.get(value as object) : undefined
  if (!record || record.issuerIdentity !== identity) {
    invalid("Owner state commitment is structural or belongs to another issuer")
  }
  return record
}

function parseCanonicalNames(value: unknown, label: string, maximum: number): readonly string[] {
  requireDenseBoundedArray(value, maximum, `Owner state commitment ${label} names`)
  let previous: string | undefined
  const names = value.map((item) => {
    const name = parseCanonicalName(item, label)
    if (previous !== undefined && compareUtf8(previous, name) >= 0) {
      invalid(`Owner state commitment ${label} names must be unique and UTF-8 sorted`)
    }
    previous = name
    return name
  })
  return Object.freeze(names)
}

function parseCanonicalName(value: unknown, label: string): string {
  assertNfcScalarString(value, `Owner state commitment ${label} name`)
  if (
    value.length === 0 ||
    value.includes("\u0000") ||
    utf8ByteLength(value) > Number(OWNER_STATE_MAX_CANONICAL_NAME_UTF8_BYTES)
  ) {
    invalid(`Owner state commitment ${label} name is outside the canonical bound`)
  }
  return value
}

function parseCanonicalKey(value: unknown): string {
  assertNfcScalarString(value, "Owner state commitment key")
  if (
    value.length === 0 ||
    value.includes("\u0000") ||
    utf8ByteLength(value) > Number(OWNER_STATE_MAX_CANONICAL_KEY_UTF8_BYTES)
  ) {
    invalid("Owner state commitment key is outside the canonical bound")
  }
  return value
}

function requireDeclaredName(value: unknown, names: readonly string[], label: string): string {
  const name = parseCanonicalName(value, label)
  if (!names.includes(name)) invalid(`Owner state commitment ${label} name is not declared`)
  return name
}

function assertExactClosedNames(
  values: ReadonlyMap<string, unknown>,
  expected: readonly string[],
  label: string,
): void {
  if (values.size !== expected.length || expected.some((name) => !values.has(name))) {
    invalid(`Owner state commitment does not provide the exact ${label} name set`)
  }
}

function requireDenseBoundedArray(
  value: unknown,
  maximum: number,
  label: string,
): asserts value is readonly unknown[] {
  assertDenseArray(value, label)
  if (value.length > maximum) invalid(`${label} exceeds its bound`)
}

function commonPrefixLength(prefix: Uint8Array, path: Uint8Array, offset: number): number {
  const maximum = Math.min(prefix.byteLength, path.byteLength - offset)
  let index = 0
  while (index < maximum && prefix[index] === path[offset + index]) index += 1
  return index
}

function findChild(children: readonly RadixChild[], edge: number): number {
  let lower = 0
  let upper = children.length
  while (lower < upper) {
    const middle = (lower + upper) >>> 1
    if (children[middle]!.edge < edge) lower = middle + 1
    else upper = middle
  }
  return lower
}

function sortChildren(children: readonly RadixChild[]): readonly RadixChild[] {
  return children.slice().sort((left, right) => left.edge - right.edge)
}

function byteStringHex(bytes: Uint8Array): string {
  let output = ""
  for (const byte of bytes) output += byte.toString(16).padStart(2, "0")
  return output
}

function emptyWork(): WorkCounter {
  return { leafHashCount: 0, nodeHashCount: 0, pathCopyCount: 0, visitedKeyBytes: 0, valueJcsBytes: 0 }
}

function finishWork(
  work: WorkCounter,
  collections: ReadonlyMap<string, CollectionState>,
): OwnerStateCommitmentWork {
  let entryCount = 0
  let nodeCount = 0
  for (const collection of collections.values()) {
    entryCount += collection.root?.entryCount ?? 0
    nodeCount += collection.root?.nodeCount ?? 0
  }
  return Object.freeze({ ...work, entryCount, nodeCount })
}

function requireMapValue<K, V>(map: ReadonlyMap<K, V>, key: K): V {
  const value = map.get(key)
  if (value === undefined) invalid("Owner state commitment closed name is missing")
  return value
}

function invalid(message: string): never {
  throw new CollaborationCodecError("invalid-canonical-jcs", message)
}
