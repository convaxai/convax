import { KERNEL_LIMITS } from "./constants"
import { CollaborationCodecError } from "./errors"

export type KernelCapacityKind =
  | "pending-document"
  | "pending-remote-actor"
  | "local-outbox-document"
  | "retained-durable-acks"
  | "project-quarantine"
  | "local-recovery-branch"

export interface KernelCapacityUsage {
  readonly bytes?: number
  readonly items: number
}

/** Pure outer-cap primitive for the Project persistence adapter and pending-inbox port. */
export function assertKernelCapacity(kind: KernelCapacityKind, usage: KernelCapacityUsage): void {
  assertSafeCount(usage.items, "capacity items")
  if (usage.bytes !== undefined) assertSafeCount(usage.bytes, "capacity bytes")
  const [maximumItems, maximumBytes] = capacity(kind)
  if (usage.items > maximumItems || (maximumBytes !== undefined && (usage.bytes ?? 0) > maximumBytes)) {
    throw new CollaborationCodecError("invalid-codec", `${kind} exceeds the current protocol capacity`)
  }
}

function capacity(kind: KernelCapacityKind): readonly [number, number | undefined] {
  switch (kind) {
    case "pending-document": return [KERNEL_LIMITS.pendingInboxFramesPerDocument, KERNEL_LIMITS.pendingInboxBytesPerDocument]
    case "pending-remote-actor": return [KERNEL_LIMITS.pendingInboxFramesPerRemoteActor, KERNEL_LIMITS.pendingInboxBytesPerRemoteActor]
    case "local-outbox-document": return [KERNEL_LIMITS.localOutboxFramesPerDocument, KERNEL_LIMITS.localOutboxBytesPerDocument]
    case "retained-durable-acks": return [KERNEL_LIMITS.retainedDurableAcksPerFrame, undefined]
    case "project-quarantine": return [KERNEL_LIMITS.quarantineObjectsPerProject, KERNEL_LIMITS.quarantineBytesPerProject]
    case "local-recovery-branch": return [1, KERNEL_LIMITS.localRecoveryBranchBytes]
  }
}

function assertSafeCount(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new CollaborationCodecError("invalid-codec", `${label} must be a nonnegative safe integer`)
}
