import { createHmac, timingSafeEqual } from "node:crypto"
import { canonicalJson, sha256Hex } from "./canonical.js"
import type { MarketplaceDelivery, MarketplaceItemKind, MarketplaceKind, Presentation } from "./schemas.js"

export * from "./schemas.js"
export * from "./server-schema.js"
export * from "./product-lock.js"
export * from "./canonical.js"
export * from "./builtin-archive.js"

declare const sourceKeyBrand: unique symbol
declare const selectionTokenBrand: unique symbol
export type SourceKey = string & { readonly [sourceKeyBrand]: true }
export type SelectionToken = string & { readonly [selectionTokenBrand]: true }

/**
 * The one product-defined Builtin source identity. Bundle release ids, policy
 * revisions, and member lists are content state and must never enter SourceKey.
 */
export const BUILTIN_SOURCE_IDENTITY = {
  kind: "builtin",
  marketplaceId: "convax-builtin",
  sourceInstanceId: "convax-product-builtin",
  policyVersion: 1,
} as const

export type BuiltinSourceIdentity = typeof BUILTIN_SOURCE_IDENTITY

export type SourceIdentity =
  | {
      kind: "network"
      marketplaceId: string
      descriptorUrl: string
      repository: { owner: string; name: string }
      deliveryPolicy: "github-pages-releases"
    }
  | BuiltinSourceIdentity
  | {
      kind: "local"
      marketplaceId: string
      sourceInstanceId: string
      policyVersion: number
    }

export interface SourceQualifiedItem {
  marketplaceId: string
  sourceKey: SourceKey
  sourceKind: MarketplaceKind
  sourceOrder: number
  official: boolean
  kind: MarketplaceItemKind
  id: string
  version: string
  catalogSequence: number
  catalogRevision: string
  runtimeSurface: "none" | "agent" | "agent-and-convax"
  compatibility: { convax: string }
  presentation: Presentation
  delivery: MarketplaceDelivery
}

export interface CatalogDisplayGroup {
  identity: { kind: MarketplaceItemKind; id: string }
  representative: SourceQualifiedItem
  sources: readonly SourceQualifiedItem[]
  requiresSourceSelection: boolean
}

export interface InstalledSourceIdentity {
  kind: MarketplaceItemKind
  id: string
  sourceKey: SourceKey
  version: string
}

export interface SourceSecurityState {
  sequence: number
  revision: string
  catalogDigest: string
  versionContracts: Readonly<Record<string, string>>
}

export interface SelectionTokenPayload {
  senderId: string
  expiresAt: number
  ref: { marketplaceId: string; kind: MarketplaceItemKind; id: string }
  sourceKey: SourceKey
  catalogSequence: number
  catalogRevision: string
  version: string
  metadataDigest: string
  artifact: { url: string; size: number; sha256: string } | null
  companion: { target: string; url: string; size: number; sha256: string } | null
}

export function resolveSourceRegistration(
  existing: { marketplaceId: string; sourceKey: SourceKey } | undefined,
  candidate: { marketplaceId: string; sourceKey: SourceKey },
): "add" | "no-op" | "identity-collision" {
  if (!existing) return "add"
  if (existing.marketplaceId !== candidate.marketplaceId) return "add"
  return existing.sourceKey === candidate.sourceKey ? "no-op" : "identity-collision"
}

const MAX_SECURITY_CONTRACTS = 16_384
const MAX_SECURITY_BYTES = 8 * 1024 * 1024

export function computeSourceKey(identity: SourceIdentity): SourceKey {
  return sha256Hex(canonicalJson(identity)) as SourceKey
}

export function builtinSourceKey(): SourceKey {
  return computeSourceKey(BUILTIN_SOURCE_IDENTITY)
}

export function identityKeyForMcpServer(name: string): string {
  return sha256Hex(`mcp-server\0${name}`)
}

export function versionKeyForMcpServer(name: string, version: string): string {
  return sha256Hex(`mcp-server-version\0${name}\0${version}`)
}

function compareAscii(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function representativeRank(item: SourceQualifiedItem): readonly [number, number, string] {
  if (item.sourceKind === "builtin") return [0, 0, item.marketplaceId]
  if (item.official) return [1, 0, item.marketplaceId]
  if (item.sourceKind === "network") return [2, item.sourceOrder, item.marketplaceId]
  return [3, item.sourceOrder, item.marketplaceId]
}

function compareRank(left: SourceQualifiedItem, right: SourceQualifiedItem): number {
  const a = representativeRank(left)
  const b = representativeRank(right)
  return a[0] - b[0] || a[1] - b[1] || compareAscii(a[2], b[2])
}

export function aggregateCatalog(
  items: readonly SourceQualifiedItem[],
  installed: readonly InstalledSourceIdentity[] = [],
): CatalogDisplayGroup[] {
  const installedByIdentity = new Map(installed.map((entry) => [`${entry.kind}\0${entry.id}`, entry]))
  const groups = new Map<string, SourceQualifiedItem[]>()
  for (const item of items) {
    const key = `${item.kind}\0${item.id}`
    const sourceItems = groups.get(key) ?? []
    if (sourceItems.some((existing) => existing.sourceKey === item.sourceKey)) {
      throw new TypeError(`duplicate source item ${item.marketplaceId}/${item.kind}/${item.id}`)
    }
    sourceItems.push(item)
    groups.set(key, sourceItems)
  }
  return [...groups.entries()]
    .sort(([left], [right]) => compareAscii(left, right))
    .map(([key, sources]) => {
      const installedIdentity = installedByIdentity.get(key)
      const installedSource = installedIdentity
        ? sources.find((source) => source.sourceKey === installedIdentity.sourceKey)
        : undefined
      const sortedSources = [...sources].sort(compareRank)
      return {
        identity: { kind: sources[0].kind, id: sources[0].id },
        representative: installedSource ?? sortedSources[0],
        sources: sortedSources,
        requiresSourceSelection: !installedIdentity && sources.length > 1,
      }
    })
}

export function resolveInstallConflict(
  installed: InstalledSourceIdentity | undefined,
  candidate: { kind: MarketplaceItemKind; id: string; sourceKey: SourceKey },
): "new-install" | "same-source-update" | "source-conflict" {
  if (!installed || installed.kind !== candidate.kind || installed.id !== candidate.id) return "new-install"
  return installed.sourceKey === candidate.sourceKey ? "same-source-update" : "source-conflict"
}

export function decideSourceMutation(
  current: SourceSecurityState | undefined,
  candidate: SourceSecurityState,
): SourceSecurityState {
  if (
    !Number.isSafeInteger(candidate.sequence) ||
    candidate.sequence < 1 ||
    !/^[0-9a-f]{64}$/.test(candidate.revision) ||
    !/^[0-9a-f]{64}$/.test(candidate.catalogDigest)
  ) {
    throw new TypeError("invalid SourceSecurityState identity")
  }
  if (current && candidate.sequence < current.sequence) throw new TypeError("source sequence rollback")
  if (current && candidate.sequence === current.sequence) {
    if (
      candidate.revision !== current.revision ||
      candidate.catalogDigest !== current.catalogDigest ||
      canonicalJson(candidate.versionContracts) !== canonicalJson(current.versionContracts)
    ) {
      throw new TypeError("source sequence reuse changed accepted bytes")
    }
    return current
  }
  for (const [identity, digest] of Object.entries(candidate.versionContracts)) {
    if (!/^[0-9a-f]{64}$/.test(digest)) throw new TypeError(`invalid version contract digest for ${identity}`)
    const previous = current?.versionContracts[identity]
    if (previous && previous !== digest) throw new TypeError(`same version changed contract for ${identity}`)
  }
  const merged: SourceSecurityState = {
    ...candidate,
    versionContracts: { ...current?.versionContracts, ...candidate.versionContracts },
  }
  if (Object.keys(merged.versionContracts).length > MAX_SECURITY_CONTRACTS) {
    throw new TypeError("SourceSecurityState version contract limit exceeded")
  }
  if (new TextEncoder().encode(canonicalJson(merged)).byteLength > MAX_SECURITY_BYTES) {
    throw new TypeError("SourceSecurityState byte limit exceeded")
  }
  return merged
}

function base64url(value: Uint8Array): string {
  return Buffer.from(value).toString("base64url")
}

const MAX_SELECTION_TOKEN_BYTES = 16 * 1024
const MAX_SELECTION_PAYLOAD_BYTES = 8 * 1024
const MAX_SELECTION_TTL_MS = 5 * 60 * 1_000

function parseSelectionPayload(rawPayload: unknown, now: number): SelectionTokenPayload {
  if (!Number.isSafeInteger(now) || now < 0) throw new TypeError("invalid selection token clock")
  if (!rawPayload || typeof rawPayload !== "object" || Array.isArray(rawPayload)) {
    throw new TypeError("invalid selection token payload")
  }
  const candidate = rawPayload as Record<string, unknown>
  const expectedKeys =
    "artifact,catalogRevision,catalogSequence,companion,expiresAt,metadataDigest,ref,senderId,sourceKey,version"
  if (Object.keys(candidate).sort().join(",") !== expectedKeys)
    throw new TypeError("invalid selection token payload fields")
  if (
    typeof candidate.senderId !== "string" ||
    candidate.senderId.length === 0 ||
    candidate.senderId.length > 256 ||
    !Number.isSafeInteger(candidate.expiresAt) ||
    Number(candidate.expiresAt) <= now ||
    Number(candidate.expiresAt) - now > MAX_SELECTION_TTL_MS ||
    !Number.isSafeInteger(candidate.catalogSequence) ||
    Number(candidate.catalogSequence) < 1 ||
    typeof candidate.catalogRevision !== "string" ||
    !/^[0-9a-f]{64}$/.test(candidate.catalogRevision) ||
    typeof candidate.version !== "string" ||
    candidate.version.length === 0 ||
    candidate.version.length > 255 ||
    typeof candidate.sourceKey !== "string" ||
    !/^[0-9a-f]{64}$/.test(candidate.sourceKey) ||
    typeof candidate.metadataDigest !== "string" ||
    !/^[0-9a-f]{64}$/.test(candidate.metadataDigest)
  ) {
    throw new TypeError("invalid selection token payload values")
  }
  const ref = candidate.ref
  if (!ref || typeof ref !== "object" || Array.isArray(ref)) throw new TypeError("invalid selection token ref")
  const refRecord = ref as Record<string, unknown>
  if (
    Object.keys(refRecord).sort().join(",") !== "id,kind,marketplaceId" ||
    typeof refRecord.marketplaceId !== "string" ||
    !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(refRecord.marketplaceId) ||
    typeof refRecord.id !== "string" ||
    refRecord.id.length === 0 ||
    refRecord.id.length > 200 ||
    !/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(refRecord.id) ||
    (refRecord.kind !== "plugin" && refRecord.kind !== "skill" && refRecord.kind !== "mcp-server")
  ) {
    throw new TypeError("invalid selection token ref")
  }
  const parseImmutable = (
    value: unknown,
    kind: "artifact" | "companion",
  ): SelectionTokenPayload["artifact"] | SelectionTokenPayload["companion"] => {
    if (value === null) return null
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`invalid token ${kind}`)
    const entry = value as Record<string, unknown>
    const wanted = kind === "artifact" ? "sha256,size,url" : "sha256,size,target,url"
    let url: URL
    try {
      url = new URL(typeof entry.url === "string" ? entry.url : "")
    } catch {
      throw new TypeError(`invalid token ${kind} URL`)
    }
    if (
      Object.keys(entry).sort().join(",") !== wanted ||
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      !Number.isSafeInteger(entry.size) ||
      Number(entry.size) <= 0 ||
      Number(entry.size) > 128 * 1024 * 1024 ||
      typeof entry.sha256 !== "string" ||
      !/^[0-9a-f]{64}$/.test(entry.sha256) ||
      (kind === "companion" &&
        (typeof entry.target !== "string" || !/^(darwin|linux|win32)-(arm64|x64)$/.test(entry.target)))
    ) {
      throw new TypeError(`invalid token ${kind}`)
    }
    return entry as SelectionTokenPayload["artifact"] | SelectionTokenPayload["companion"]
  }
  return {
    senderId: candidate.senderId,
    expiresAt: Number(candidate.expiresAt),
    ref: refRecord as SelectionTokenPayload["ref"],
    sourceKey: candidate.sourceKey as SourceKey,
    catalogSequence: Number(candidate.catalogSequence),
    catalogRevision: candidate.catalogRevision,
    version: candidate.version,
    metadataDigest: candidate.metadataDigest,
    artifact: parseImmutable(candidate.artifact, "artifact") as SelectionTokenPayload["artifact"],
    companion: parseImmutable(candidate.companion, "companion") as SelectionTokenPayload["companion"],
  }
}

export function issueSelectionToken(
  payload: SelectionTokenPayload,
  secret: Uint8Array,
  now = Date.now(),
): SelectionToken {
  if (secret.byteLength < 32) throw new TypeError("selection token secret must contain at least 32 bytes")
  const validated = parseSelectionPayload(payload, now)
  const payloadBytes = new TextEncoder().encode(canonicalJson(validated))
  if (payloadBytes.byteLength > MAX_SELECTION_PAYLOAD_BYTES) throw new TypeError("selection token payload is too large")
  const encoded = base64url(payloadBytes)
  const signature = createHmac("sha256", secret).update(encoded).digest()
  return `${encoded}.${base64url(signature)}` as SelectionToken
}

export function verifySelectionToken(
  token: SelectionToken,
  expected: { senderId: string; now: number },
  secret: Uint8Array,
): SelectionTokenPayload {
  if (typeof token !== "string" || token.length > MAX_SELECTION_TOKEN_BYTES)
    throw new TypeError("invalid selection token size")
  const [encoded, signature, extra] = token.split(".")
  if (!encoded || !signature || extra || !/^[A-Za-z0-9_-]+$/.test(encoded) || !/^[A-Za-z0-9_-]+$/.test(signature)) {
    throw new TypeError("invalid selection token")
  }
  const payloadBytes = Buffer.from(encoded, "base64url")
  const signatureBytes = Buffer.from(signature, "base64url")
  if (
    payloadBytes.byteLength > MAX_SELECTION_PAYLOAD_BYTES ||
    base64url(payloadBytes) !== encoded ||
    base64url(signatureBytes) !== signature
  ) {
    throw new TypeError("non-canonical selection token encoding")
  }
  const expectedSignature = createHmac("sha256", secret).update(encoded).digest()
  const actualSignature = signatureBytes
  if (
    actualSignature.byteLength !== expectedSignature.byteLength ||
    !timingSafeEqual(actualSignature, expectedSignature)
  ) {
    throw new TypeError("invalid selection token signature")
  }
  let rawPayload: unknown
  try {
    rawPayload = JSON.parse(payloadBytes.toString("utf8"))
  } catch {
    throw new TypeError("invalid selection token JSON")
  }
  const payload = parseSelectionPayload(rawPayload, expected.now)
  if (payload.senderId !== expected.senderId) throw new TypeError("selection token belongs to another sender")
  return payload
}

export function assertSelectionCurrent(
  selection: SelectionTokenPayload,
  current: {
    sourceKey: SourceKey
    catalogSequence: number
    catalogRevision: string
    version: string
    metadataDigest: string
    artifact: SelectionTokenPayload["artifact"]
    companion: SelectionTokenPayload["companion"]
  },
): void {
  if (
    selection.sourceKey !== current.sourceKey ||
    selection.catalogSequence !== current.catalogSequence ||
    selection.catalogRevision !== current.catalogRevision ||
    selection.version !== current.version ||
    selection.metadataDigest !== current.metadataDigest ||
    canonicalJson(selection.artifact) !== canonicalJson(current.artifact) ||
    canonicalJson(selection.companion) !== canonicalJson(current.companion)
  ) {
    throw new TypeError("stale selection")
  }
}
