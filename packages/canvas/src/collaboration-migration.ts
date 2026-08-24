/**
 * Sealed one-shot compatibility surface for Project/node. This subpath is not
 * part of the normal Canvas collaboration runtime and accepts only the exact
 * code-pinned immediate predecessor through @convax/collaboration/migration.
 */
export {
  buildImmediatePredecessorImportedCanvasGenesisProofCarrier,
  installCanvasGenesisProofCarrierVerifierFactory,
  type BuildCanvasGenesisProofCarrierResult,
  type CanvasGenesisBuildAuthor,
  type CanvasGenesisHistoricalAuthorVerifierPort,
  type CanvasGenesisProofCarrierVerifier,
} from "./collaboration/genesis"
export {
  immediatePredecessorCanvasCanonicalStateDigest,
  rebuildImmediatePredecessorCanvasDocument,
  type RebuildImmediatePredecessorCanvasInput,
} from "./collaboration/immediate-predecessor-migration"
