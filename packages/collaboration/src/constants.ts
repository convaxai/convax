export const COLLABORATION_PROTOCOL_MAJOR_V2 = 2 as const
export const CAUSAL_EDIT_KIND_CODE_V2 = 1 as const
export const CAUSAL_EDIT_MAGIC_V2 = "CVXCOLL2" as const
export const CAUSAL_EDIT_PREFIX_BYTES_V2 = 88 as const

export const PINNED_AUTHORITY_IDENTITIES_V2 = Object.freeze({
  authorityRevision: "r5",
  manifestSha256: "2d4fa5170d6501f7049a1f58fc1c691e210a6db92454da4ebc09dad9ab4596ed",
  protocolBundleSha256: "163cabcd8ab5f45acd1fdf7309c747185a6132c9765585a310515f3c968ca786",
  protocolDigest: "de192e03a7466b631b1cefa50f745e22b1ed997f5ce23cbb9c9aea7e46b73bf5",
  uriProtocolDigest: "9030aecd6902888e5e91532fcc2ec3f1a377e79ae59c092ee80fbbf1a01fac38",
  limitsDigest: "88c018e5289f8b9a359f6ae171aed00885d5fa0913f4a1c36274b35e4cee12f7",
  channelContractDigest: "0fa34e8d93f26e585e6d9baa0ecf0c09a38494d03247b91843e2bca0e93df242",
} as const)

export const PROTOCOL_SCHEMA_ARTIFACTS_V2 = Object.freeze([
  Object.freeze({
    artifactDigest: "cb69352106c9fc61d28c6412b22b7efb453cd7b9db5324946c0d978772c54d36",
    format: "convax.canvas-protocol-schema/2",
    name: "canvas-schema",
  }),
  Object.freeze({
    artifactDigest: "357bacba24e9be648f7d280fc474c421a5986c002040899b7f382615e8113e01",
    format: "convax.collaboration-kernel-protocol-schema/2",
    name: "collaboration-kernel",
  }),
  Object.freeze({
    artifactDigest: "ac6605ee974a47be65a02c478e854971cbd54146db147cf943391a0f4f557e45",
    format: "convax.control-plane-protocol-schema/2",
    name: "control-plane",
  }),
  Object.freeze({
    artifactDigest: "38f3d762cfd95a6826758750d3cdb518d900ac0b15b8338aa6dfd58733e9353c",
    format: "convax.project-persistence-protocol-schema/2",
    name: "project-persistence",
  }),
] as const)

export const PROTOCOL_TYPE_NAMESPACES_V2 = Object.freeze([
  Object.freeze({ namespace: "canvas-schema", imports: Object.freeze(["collaboration-kernel", "control-plane", "global-uri"] as const) }),
  Object.freeze({ namespace: "collaboration-kernel", imports: Object.freeze(["global-uri"] as const) }),
  Object.freeze({ namespace: "control-plane", imports: Object.freeze(["collaboration-kernel", "global-uri", "project-persistence"] as const) }),
  Object.freeze({ namespace: "global-uri", imports: Object.freeze([] as const) }),
  Object.freeze({ namespace: "project-persistence", imports: Object.freeze(["canvas-schema", "collaboration-kernel", "control-plane", "global-uri"] as const) }),
] as const)

export const YJS_WIRE_CODEC_V2 = Object.freeze({
  applyCodec: "Y.applyUpdate",
  format: "convax.yjs-wire-codec/2",
  package: "yjs",
  packageIntegrity: "sha512-Eq+5BRfbeGyqGVrTJL3bEcr8gKkxPuyuoHmAwpk52fDb8kOVMrfVSTRPd6yiGgX5Fskb96qCRjzjbRjrL4YEnw==",
  stateVectorCodec: "Y.encodeStateVector",
  updateCodec: "Y.encodeStateAsUpdate",
  updateVersion: "v1",
  version: "13.6.31",
} as const)

export const KERNEL_LIMITS_V2 = Object.freeze({
  actualWriteEvidenceJcsBytes: 256 * 1024,
  causalContextJcsBytes: 64 * 1024,
  causalDependencyRefs: 256,
  causalEnvelopeBytes: 2 * 1024 * 1024,
  causalFrontierHeads: 256,
  causalHeaderJcsBytes: 64 * 1024,
  checkpointFrontierHeads: 256,
  checkpointParents: 8,
  checkpointSnapshotBytes: 32 * 1024 * 1024,
  changedPaths: 2_048,
  localOutboxBytesPerDocument: 512 * 1024 * 1024,
  localOutboxFramesPerDocument: 4_096,
  localRecoveryBranchBytes: 1024 * 1024 * 1024,
  oneChangedPathUtf8Bytes: 512,
  pendingInboxBytesPerDocument: 256 * 1024 * 1024,
  pendingInboxBytesPerRemoteActor: 32 * 1024 * 1024,
  pendingInboxFramesPerDocument: 4_096,
  pendingInboxFramesPerRemoteActor: 512,
  quarantineBytesPerProject: 128 * 1024 * 1024,
  quarantineObjectsPerProject: 1_024,
  retainedDurableAcksPerFrame: 32,
  stateVectorBytes: 64 * 1024,
  stableSetCertificates: 8,
  typedIntentJcsBytes: 512 * 1024,
  validationArtifactRefs: 64,
  writes: 2_048,
  yjsUpdateBytes: 1024 * 1024,
} as const)

export const KERNEL_DIGEST_DOMAINS_V2 = Object.freeze({
  actualWriteEvidence: "convax.actual-write-evidence/2",
  canonicalState: "convax.canonical-state/2",
  causalContext: "convax.causal-context/2",
  causalDependencySet: "convax.causal-dependency-set/2",
  causalEditCore: "convax.causal-edit-core/2",
  causalEditFrameDigest: "convax.causal-edit-frame-digest/2",
  causalEditSignature: "convax.causal-edit-signature/2",
  causalFrontier: "convax.causal-frontier/2",
  causalHeadRef: "convax.causal-head-ref/2",
  checkpointContentCertificateCore: "convax.checkpoint-content-certificate-core/2",
  checkpointContentCertificate: "convax.checkpoint-content-certificate/2",
  documentScope: "convax.document-scope/2",
  ownerActualWriteEvidence: "convax.owner-actual-write-evidence/2",
  ownerCanonicalizerDescriptor: "convax.owner-canonicalizer-descriptor/2",
  protocolSchemaArtifact: "convax.protocol-schema-artifact/2",
  protocolSchemaBundleCore: "convax.protocol-schema-bundle-core/2",
  prunableCheckpointSetCertificateCore: "convax.prunable-checkpoint-set-certificate-core/2",
  prunableCheckpointSetCertificate: "convax.prunable-checkpoint-set-certificate/2",
  replicaActorHeadSet: "convax.replica-actor-head-set/2",
  replicaCausalFloorAckCore: "convax.replica-causal-floor-ack-core/2",
  replicaCausalFloorAck: "convax.replica-causal-floor-ack/2",
  replicaCheckpointCore: "convax.replica-checkpoint-core/2",
  replicaCheckpoint: "convax.replica-checkpoint/2",
  stableCheckpointSetCore: "convax.stable-checkpoint-set-core/2",
  stateVector: "convax.state-vector/2",
  typedIntent: "convax.typed-intent/2",
  validationArtifactSet: "convax.validation-artifact-set/2",
  yjsUpdate: "convax.yjs-update/2",
} as const)
