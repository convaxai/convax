export type CollaborationFailureCode =
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

export class CollaborationError extends Error {
  constructor(
    readonly code: CollaborationFailureCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.name = this.constructor.name
  }
}

export class ProtocolAuthorityError extends CollaborationError {}
export class CollaborationCodecError extends CollaborationError {}
export class CollaborationFrameError extends CollaborationError {}
export class CollaborationKernelError extends CollaborationError {}

export function failCodec(message: string, options?: ErrorOptions): never {
  throw new CollaborationCodecError("invalid-codec", message, options)
}

export function failFrame(message: string, options?: ErrorOptions): never {
  throw new CollaborationFrameError("invalid-causal-frame", message, options)
}
