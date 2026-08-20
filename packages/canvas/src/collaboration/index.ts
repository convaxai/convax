export {
  buildCanvasProjectionIndex,
  canonicalProjectionBytes,
  canvasProjectionPluginIdentityMetadataKey,
  canvasProjectionPluginStateMetadataKey,
  canvasProjectionResourceMetadataKey,
  dataRegisterDigest,
  edgeIdentityDigest,
  effectiveDataDigest,
  effectiveNodeData,
  effectivePlugin,
  effectivePluginDigest,
  generationLifecycleCore,
  generationLifecycleDigest,
  geometryDigest,
  nodeIdentityDigest,
  obstacleProjectionDigest,
  projectedGenerationDigestV2,
  projectCanvas,
  projectCanvasDocument,
  projectionDigest,
  type CanvasDocumentProjection,
  type CanvasProjectionIndex,
} from "./projection"
export * from "./application-command-adapter"
export * from "./blob-dependencies"
export * from "./command-construction"
export * from "./external-facts"
export * from "./genesis"
export * from "./history-schedule"
export {
  applyCanvasCandidateIntent,
  materializeCanvasSemanticHistoryIntent,
  reduceCanvasIntent,
  type CanvasReducerOutcome,
} from "./reducer"
export * from "./session"
export * from "./intent-validation"
export * from "./operation-id"
export * from "./types"
export * from "./validation"
export {
  CANVAS_ROOT_KEYS,
  CANVAS_ROOT_NAME,
  cloneCanvasYDoc,
  createCanvasReconstructionYDoc,
  createCanvasYDoc,
  encodeCanvasCanonicalState,
  extractCanvasCanonicalState,
  getCanvasChildMap,
  getCanvasRoot,
  validateCanvasYDoc,
} from "./ydoc"
