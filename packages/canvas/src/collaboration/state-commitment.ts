import {
  OWNER_STATE_CANONICAL_KEY_PATH_POLICY,
  OWNER_STATE_COMMITMENT_CODEC,
  OWNER_STATE_MAX_CANONICAL_KEY_UTF8_BYTES,
  OWNER_STATE_MAX_CANONICAL_NAME_UTF8_BYTES,
  compareUtf8,
  type OwnerStateCommitmentDescriptor,
  type OwnerStateCommitmentMutation,
  type OwnerStateCommitmentSource,
} from "@convax/collaboration"
import type { CanvasSnapshot } from "./types"

const SCALAR_NAMES = Object.freeze(["format", "identity", "meta"] as const)
const COLLECTION_NAMES = Object.freeze([
  "containments",
  "edges",
  "generationBegins",
  "generationDismissals",
  "generationRecoveryFailures",
  "generationTerminals",
  "nodes",
  "operations",
  "semanticHistory",
] as const)

type CanvasCommitmentCollectionName = (typeof COLLECTION_NAMES)[number]

export const CANVAS_STATE_COMMITMENT_DESCRIPTOR: OwnerStateCommitmentDescriptor = Object.freeze({
  format: "convax.owner-state-commitment-descriptor",
  commitmentCodec: OWNER_STATE_COMMITMENT_CODEC,
  canonicalKeyPathPolicy: OWNER_STATE_CANONICAL_KEY_PATH_POLICY,
  maxCanonicalNameUtf8Bytes: OWNER_STATE_MAX_CANONICAL_NAME_UTF8_BYTES,
  maxCanonicalKeyUtf8Bytes: OWNER_STATE_MAX_CANONICAL_KEY_UTF8_BYTES,
  scalarNames: SCALAR_NAMES,
  collectionNames: COLLECTION_NAMES,
})

let coldSourceEntries = 0
let incrementalChangedKeys = 0
let incrementalHistoricalEntries = 0

/** Package-private structural evidence; never enters protocol state or package exports. */
export function canvasStateCommitmentWorkCounts() {
  return Object.freeze({ coldSourceEntries, incrementalChangedKeys, incrementalHistoricalEntries })
}

export function canvasStateCommitmentSource(
  snapshot: CanvasSnapshot,
  descriptor: OwnerStateCommitmentDescriptor,
): OwnerStateCommitmentSource {
  const collections = COLLECTION_NAMES.map((name) => {
    const entries = [...canvasCommitmentCollection(snapshot, name).entries()]
      .sort((left, right) => compareUtf8(left[0], right[0]))
      .map(([key, value]) => Object.freeze({ key, value: canvasCommitmentValue(name, value) }))
    coldSourceEntries += entries.length
    return Object.freeze({ name, entries: Object.freeze(entries) })
  })
  return Object.freeze({
    descriptor,
    scalars: Object.freeze([
      Object.freeze({ name: "format", value: "convax.canvas-canonical-state" }),
      Object.freeze({ name: "identity", value: snapshot.identity }),
      Object.freeze({ name: "meta", value: snapshot.meta }),
    ]),
    collections: Object.freeze(collections),
  })
}

export function canvasStateCommitmentMutations(
  snapshot: CanvasSnapshot,
  changed: ReadonlyMap<string, readonly string[]>,
): readonly OwnerStateCommitmentMutation[] {
  for (const name of changed.keys()) {
    if (!(COLLECTION_NAMES as readonly string[]).includes(name)) {
      throw new TypeError(`Canvas incremental commitment cannot mutate ${name}`)
    }
  }
  const mutations: OwnerStateCommitmentMutation[] = []
  for (const name of COLLECTION_NAMES) {
    const collection = canvasCommitmentCollection(snapshot, name)
    const keys = [...(changed.get(name) ?? [])].sort(compareUtf8)
    incrementalChangedKeys += keys.length
    for (const key of keys) {
      const value = collection.get(key)
      mutations.push(
        value === undefined
          ? Object.freeze({ kind: "delete", collection: name, key })
          : Object.freeze({ kind: "set", collection: name, key, value: canvasCommitmentValue(name, value) }),
      )
    }
  }
  // This function performs keyed reads only. The explicit counter makes a
  // regression to base-collection enumeration falsifiable in Canvas tests.
  incrementalHistoricalEntries += 0
  return Object.freeze(mutations)
}

function canvasCommitmentCollection(
  snapshot: CanvasSnapshot,
  name: CanvasCommitmentCollectionName,
): ReadonlyMap<string, unknown> {
  return snapshot[name] as ReadonlyMap<string, unknown>
}

function canvasCommitmentValue(name: CanvasCommitmentCollectionName, value: unknown): unknown {
  if (name !== "nodes" && name !== "edges") return value
  if (typeof value !== "object" || value === null || !("key" in value)) {
    throw new TypeError(`Canvas ${name} commitment value is invalid`)
  }
  const { key: _key, ...record } = value as Record<string, unknown>
  return record
}
