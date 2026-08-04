export type CollaborationFailureCodeV2 =
  | "protocol-schema-bundle-unavailable"
  | "canonical-authority-conflict"
  | "unsupported-yjs-codec"
  | "state-vector-limit"
  | "dependency-pending"
  | "exact-base-unavailable"
  | "stale-local-head"
  | "equivocation-quarantine"
  | "outbox-backpressure"
  | "history-reset-after-commit"
  | "read-only-recovery-required"
  | "invalid-binary"
  | "invalid-canonical-jcs"
  | "invalid-codec"
  | "invalid-causal-frame"
  | "invalid-owner-result"
  | "cancelled"
  | "disposed"

export class CollaborationErrorV2 extends Error {
  constructor(
    readonly code: CollaborationFailureCodeV2,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.name = this.constructor.name
  }
}

export class ProtocolAuthorityErrorV2 extends CollaborationErrorV2 {}
export class CollaborationCodecErrorV2 extends CollaborationErrorV2 {}
export class CollaborationFrameErrorV2 extends CollaborationErrorV2 {}
export class CollaborationKernelErrorV2 extends CollaborationErrorV2 {}

export function failCodec(message: string, options?: ErrorOptions): never {
  throw new CollaborationCodecErrorV2("invalid-codec", message, options)
}

export function failFrame(message: string, options?: ErrorOptions): never {
  throw new CollaborationFrameErrorV2("invalid-causal-frame", message, options)
}
