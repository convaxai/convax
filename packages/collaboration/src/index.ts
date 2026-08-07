export {
  CURRENT_PROTOCOL_DESCRIPTOR_FILE_NAME,
  CURRENT_PROTOCOL_DESCRIPTOR_FORMAT,
  currentProtocolDescriptor,
  encodeCurrentProtocolDescriptor,
  installCurrentProtocolAuthority,
  parseCurrentProtocolDescriptor,
} from "./current-protocol"
export { CURRENT_PROTOCOL_IDENTITIES } from "./constants"
export type {
  CanonicalJcsEvidence,
  CanonicalJcsEvidenceIssuer,
} from "./canonical-jcs-evidence"

export type {
  CurrentProtocolArtifactDescriptor,
  CurrentProtocolDescriptor,
  CurrentProtocolTypeNamespaceDescriptor,
  CurrentProtocolYjsWireCodecDescriptor,
} from "./current-protocol"

export type { CurrentProtocolAuthority } from "./authority"

export { createWebCryptoEd25519Verifier, verifyExactEd25519 } from "./crypto"
export type { Ed25519VerifierPort, ReplicaSignerPort } from "./crypto"
export type { YjsDocumentFactory } from "./yjs-codec"

export {
  compareDecodedBase64url,
  assertBoundedNfcString,
  decodeBase64url,
  encodeBase64url,
  incrementUint64,
  parseActorId,
  parseCanvasId,
  parseDigest,
  parseId128,
  parseMemberId,
  parsePeerId,
  parseProjectId,
  parsePublicKey,
  parseReplicaId,
  parseSessionId,
  parseSignature,
  parseUint32,
  parseUint64,
  replicaIdToYjsClientId,
  uint32ToNumber,
  uint64ToBigInt,
} from "./codecs"
export type {
  ActorId,
  CanvasId,
  Digest,
  Id128,
  MemberId,
  PeerId,
  ProjectId,
  PublicKey,
  ReplicaId,
  SessionId,
  Signature,
  StateVector,
  Uint32,
  Uint64,
} from "./codecs"

export {
  assertDenseArray,
  assertExactKeys,
  assertNfcScalarString,
  compareBytes,
  compareUtf8,
  decodeRestrictedJcs,
  encodeRestrictedJcsText,
  encodeRestrictedJcs,
  isPlainDataObject,
} from "./jcs"
export { ordinarySha256, rawDomainDigest, structuredDigest } from "./digest"
export { comparePortableStamps, causalFrontierDigest, documentScopeDigest, maxCausalFrontier } from "./causal"
export type { CausalClosurePort } from "./causal"
export { ownerCanonicalizerDescriptorDigest } from "./canonicalizer"
export {
  localOwnerEditAuthorizationCoreDigest,
  parseLocalOwnerEditAuthorizationCore,
} from "./local-owner-authority"
export {
  causalSignerAuthorityDigest,
  parseCausalSignerAuthority,
  parseDocumentScope,
  parsePortableStamp,
  parseValidationArtifactSet,
} from "./parse"

export {
  assertExactPruningCoverage,
  checkpointContentCertificateCoreDigest,
  checkpointContentCertificateObjectDigest,
  parseCheckpointContentCertificateCore,
  parseCheckpointContentCertificate,
  parsePrunableCheckpointSetCertificateCore,
  parsePrunableCheckpointSetCertificate,
  parseReplicaCausalFloorAckCore,
  parseReplicaCausalFloorAck,
  parseReplicaCheckpointCore,
  parseReplicaCheckpoint,
  parseStableCheckpointSetCore,
  prunableCheckpointSetCertificateCoreDigest,
  prunableCheckpointSetCertificateObjectDigest,
  replicaCausalFloorAckCoreDigest,
  replicaCausalFloorAckObjectDigest,
  replicaCheckpointCoreDigest,
  replicaCheckpointObjectDigest,
  stableCheckpointSetCoreDigest,
} from "./checkpoint"

export {
  CHECKPOINT_VALIDATION_CARRIER_PREAMBLE_BYTES,
  CHECKPOINT_VALIDATION_CARRIER_LIMITS,
  decodeCheckpointValidationCarrier,
  encodeCheckpointValidationCarrier,
  parseCheckpointValidationCarrierIndexBytes,
  parseCheckpointValidationCarrierIndex,
  parseCheckpointValidationCarrierPreamble,
} from "./checkpoint-carrier"
export type {
  CheckpointCarrierSectionKind,
  CheckpointCarrierSection,
  CheckpointValidationCarrierIndex,
  CheckpointValidationCarrierPreamble,
  DecodedCheckpointValidationCarrier,
} from "./checkpoint-carrier"

export type {
  ActualWriteEvidence,
  ActualWrite,
  CausalContext,
  CausalDependencyKind,
  CausalDependencyRef,
  CausalEditCore,
  CausalEditFrameHeader,
  CausalEditFrameSections,
  CausalFrontier,
  CausalHeadRef,
  CausalSignerAuthority,
  LocalProjectOwnerSignerAuthority,
  LocalOwnerEditAuthorizationCore,
  TeamReplicaSignerAuthority,
  CheckpointContentCertificateCore,
  CheckpointContentCertificate,
  CompleteRemoteIngressStagingPortResult,
  CompletedRemoteUpdateIngress,
  CreateOwnerExternalFactAttemptPortResult,
  DecodedCausalEditFrame,
  DocumentOwnerKind,
  DocumentOwnerProtocolDefinition,
  DocumentOwnerProtocolPort,
  DocumentOwnerRuntime,
  DocumentScopeDigest,
  DocumentScope,
  FrameObjectRef,
  FullyValidatedRemoteIngressStaging,
  InspectedOwnerIntent,
  OpenRemoteIngressSequentialCursorPortResult,
  OrdinarySha256,
  OwnerApplyResult,
  OwnerCanonicalizerDescriptor,
  OwnerExternalFactPortFactory,
  OwnerExternalFactPort,
  OwnerExternalFactRequirement,
  OwnerExternalFactResolveResult,
  OwnerExternalFactResolverDefinition,
  OwnerHistoryMaterializationDefinition,
  OwnerHistoryMaterializationPort,
  OwnerIntentClosureDefinition,
  OwnerIntentClosurePort,
  OwnerIntentConstructionContext,
  OwnerIntentDependencies,
  OwnerIntentDependencyContext,
  OwnerIntentValidationContext,
  OwnerProcessValueFactory,
  OwnerValidatedState,
  OwnerValidationArtifactResolveResult,
  PortableStamp,
  PrunableCheckpointSetCertificateCore,
  PrunableCheckpointSetCertificate,
  ProtocolSchemaArtifactManifest,
  ProtocolSchemaArtifact,
  ProtocolSchemaBundleCore,
  ProtocolSchemaBundle,
  ProtocolTypeNamespaceManifest,
  ProtocolTypeNamespace,
  PutImmutableCompletedRemoteIngressPortResult,
  RemoteImmutableIngressObjectPortEvidence,
  RemoteImmutableIngressObjectReceipt,
  RemoteIngressAckAuthority,
  RemoteIngressByteCursorRead,
  RemoteIngressByteCursor,
  RemoteIngressCompletedStagingEvidence,
  RemoteIngressImmutableObjectPersistencePort,
  RemoteIngressKind,
  RemoteIngressOwnerValidationEvidence,
  RemoteIngressQuotaReservationPortEvidence,
  RemoteIngressReservationPortEvidence,
  RemoteIngressReservationReceipt,
  RemoteIngressSequentialCursorPortHandle,
  RemoteIngressStagingPersistencePort,
  RemoteTransferAttemptBindingFactory,
  RemoteTransferAttemptBinding,
  ReplicaCausalFloorAckCore,
  ReplicaCausalFloorAck,
  ReplicaCheckpointCore,
  ReplicaCheckpoint,
  ReplicaActorHeadSet,
  ReserveRemoteIngressPortResult,
  ReserveRemoteIngressRequest,
  SelectedDocumentOwnerArtifactDefinition,
  SelectedDocumentOwnerArtifactFactory,
  StableCheckpointSetCore,
  StableRemoteTransferKey,
  UpdateIngressChunkBytes,
  ValidationArtifactOwner,
  ValidationArtifactRef,
  ValidationArtifactSet,
  YjsWireCodec,
} from "./contracts"

export {
  assertDocumentOwnerRuntime,
  assertOwnerExternalFactPort,
  createSelectedDocumentOwnerArtifactFactory,
} from "./owner-runtime"

export { CollaborationKernel } from "./kernel"
export type {
  CollaborationKernelOptions,
  IncomingFrameResult,
  LocalCommitResult,
  LocalIntentRequest,
  PreparedLocalIntent,
  ReplicaProjectionSnapshot,
} from "./kernel"
export { collaborationLatencyStages } from "./latency-diagnostics"
export type {
  CollaborationLatencyDiagnostic,
  CollaborationLatencyDiagnosticsPort,
  CollaborationLatencySample,
  CollaborationLatencyStage,
} from "./latency-diagnostics"

export {
  acceptedHeadMaterializedStateDigest,
  causalHeadRefFromDecodedFrame,
  frameObjectRefFromDecodedFrame,
  incomingFrameClosure,
  inspectAcceptedFrameObject,
  materializeAcceptedFrame,
  replicaActorHeadSetDigest,
  validateAcceptedHeadMaterializationEvidence,
} from "./accepted-head"
export type { MaterializeAcceptedFrameInput } from "./accepted-head"

export { decodeCausalEditFrame } from "./frame"
export {
  applyYjsUpdate,
  createYjsDocument,
  encodeFullUpdate,
  encodeStateVector,
  stateVectorDigest,
  yjsUpdateDigest,
} from "./yjs-codec"
export { canonicalStateDigest } from "./digest"

export type {
  AcceptedHeadMaterializationEvidence,
  AcceptedHeadView,
  CollaborationKernelPorts,
  CollaborationPersistencePort,
  CompareAndCommitReplicaHeadPortResult,
  ExactBaseResolverPort,
  ExactReconstructedBase,
  HeadCommitPortEvidence,
  HeadCommitQuarantinePortEvidence,
  IncomingAuthorityVerificationPort,
  IncomingOwnerFactResolution,
  IncomingOwnerFactResolverPort,
  JournalAppendPortEvidence,
  KernelQuarantineReason,
  LocalAuthorityPort,
  LocalFrameAuthority,
  OperationLookup,
  PendingFrameReason,
  PendingInboxPort,
  ProjectionInvalidationPort,
  ReferenceScanResult,
} from "./ports"

export {
  assertRemoteImmutableIngressObjectReceipt,
  assertRemoteTransferAttemptBinding,
  createRemoteIngressCapabilityFactory,
} from "./remote-ingress"
export type {
  CompleteRemoteIngressCapabilityResult,
  PutImmutableRemoteIngressCapabilityResult,
  RemoteIngressCapabilityFactory,
  ReserveRemoteIngressCapabilityResult,
} from "./remote-ingress"

export { TransientSessionUndoCoordinator } from "./undo"
export type {
  SessionUndoClearReason,
  SessionUndoCoordinatorOptions,
  SessionUndoCoordinator,
  SessionUndoCursor,
} from "./undo"
