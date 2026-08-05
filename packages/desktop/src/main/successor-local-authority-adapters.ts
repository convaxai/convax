import {
  documentScopeDigestV2,
  parseDigestV2,
  parseDocumentScopeV2,
  parseId128V2,
  parseProjectIdV2,
  type DigestV2,
  type DocumentScopeV2,
  type Id128V2,
  type ProjectIdV2,
} from "@convax/collaboration"
import type {
  NodeSuccessorLocalOwnerAuthorityStoreV3,
  NodeSuccessorProjectProtocolStateStoreV3,
  OpenSuccessorProjectProtocolStateV3,
} from "@convax/project/node"

import type { LocalOwnerAuthorityRecordSourceV3 } from "./local-owner-authority-source-v3"
import type { LocalOwnerPromotionBridgeSourceV3 } from "./successor-collaboration-production-runtime"

type OwnerStorePortV3 = Pick<NodeSuccessorLocalOwnerAuthorityStoreV3, "resolveExact">
type ProtocolStorePortV3 = Pick<NodeSuccessorProjectProtocolStateStoreV3, "open">

/**
 * Adapts the Project-owned active protocol closure to the V3 runtime. Local-owner
 * bytes are not activating by themselves: both sources first require the exact
 * durable protocol state and then close the requested scope against that state.
 */
export function createExactSuccessorLocalAuthoritySourcesV3(input: {
  readonly ownerStore: OwnerStorePortV3
  readonly protocolStore: ProtocolStorePortV3
}): Readonly<{
  records: LocalOwnerAuthorityRecordSourceV3
  promotionBridge: LocalOwnerPromotionBridgeSourceV3
}> {
  const records: LocalOwnerAuthorityRecordSourceV3 = Object.freeze({
    async resolveExact(requestInput: Parameters<LocalOwnerAuthorityRecordSourceV3["resolveExact"]>[0]) {
      const request = normalizeRequest(requestInput)
      const opened = await input.protocolStore.open(request.projectId)
      const state = exactLocalState(opened, request.projectId, request.projectEpoch, request.protocolDigest)
      if (state === "missing") return "missing"
      if (state === "rejected") return "rejected"
      const scopeDigest = documentScopeDigestV2(request.scope)
      const scoped = state.authorizations.find((entry) =>
        documentScopeDigestV2(entry.authorization.core.scope) === scopeDigest)
      if (!scoped || scoped.authorization.core.ownerSchemaDigest !== request.ownerSchemaDigest) return "rejected"

      const resolved = await input.ownerStore.resolveExact(request)
      if (typeof resolved === "string") return resolved
      if (
        resolved.binding.coreDigest !== state.ownerBinding.coreDigest ||
        resolved.authorization.coreDigest !== scoped.authorization.coreDigest
      ) return "rejected"
      return resolved
    },
  })

  const promotionBridge: LocalOwnerPromotionBridgeSourceV3 = Object.freeze({
    async resolveExact(requestInput: Parameters<LocalOwnerPromotionBridgeSourceV3["resolveExact"]>[0]) {
      const scope = parseDocumentScopeV2(requestInput.scope)
      const protocolDigest = parseDigestV2(requestInput.protocolDigest)
      const opened = await input.protocolStore.open(scope.projectId)
      const state = exactLocalState(opened, scope.projectId, scope.projectEpoch, protocolDigest)
      if (state === "missing" || state === "rejected") return state
      const scopeDigest = documentScopeDigestV2(scope)
      const bridge = state.bridges.find((candidate) => documentScopeDigestV2(candidate.core.scope) === scopeDigest)
      if (!bridge || bridge.core.successorProtocolDigest !== protocolDigest) return "rejected"
      return parseDigestV2(bridge.coreDigest)
    },
  })

  return Object.freeze({ records, promotionBridge })
}

function normalizeRequest(input: {
  readonly projectId: ProjectIdV2
  readonly projectEpoch: Id128V2
  readonly scope: DocumentScopeV2
  readonly ownerSchemaDigest: DigestV2
  readonly protocolDigest: DigestV2
}) {
  const projectId = parseProjectIdV2(input.projectId)
  const projectEpoch = parseId128V2(input.projectEpoch)
  const scope = parseDocumentScopeV2(input.scope)
  if (scope.projectId !== projectId || scope.projectEpoch !== projectEpoch) {
    throw new Error("Successor local authority request crossed its Project or epoch")
  }
  return Object.freeze({
    projectId,
    projectEpoch,
    scope,
    ownerSchemaDigest: parseDigestV2(input.ownerSchemaDigest),
    protocolDigest: parseDigestV2(input.protocolDigest),
  })
}

function exactLocalState(
  opened: OpenSuccessorProjectProtocolStateV3,
  projectId: ProjectIdV2,
  projectEpoch: Id128V2,
  protocolDigest: DigestV2,
) {
  if (opened.status === "not-installed") return "missing" as const
  if (opened.status !== "v3-local") return "rejected" as const
  const state = opened.state
  if (
    state.projectId !== projectId ||
    state.projectEpoch !== projectEpoch ||
    state.protocolDigest !== protocolDigest ||
    state.sharingGeneration !== "0"
  ) return "rejected" as const
  return state
}
