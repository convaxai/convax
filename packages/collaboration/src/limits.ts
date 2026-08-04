import { KERNEL_LIMITS_V2 } from "./constants"
import { CollaborationCodecErrorV2 } from "./errors"

export type KernelCapacityKindV2 =
  | "pending-document"
  | "pending-remote-actor"
  | "local-outbox-document"
  | "retained-durable-acks"
  | "project-quarantine"
  | "local-recovery-branch"

export interface KernelCapacityUsageV2 {
  readonly bytes?: number
  readonly items: number
}

/** Pure outer-cap primitive for the Project persistence adapter and pending-inbox port. */
export function assertKernelCapacityV2(kind: KernelCapacityKindV2, usage: KernelCapacityUsageV2): void {
  assertSafeCount(usage.items, "capacity items")
  if (usage.bytes !== undefined) assertSafeCount(usage.bytes, "capacity bytes")
  const [maximumItems, maximumBytes] = capacity(kind)
  if (usage.items > maximumItems || (maximumBytes !== undefined && (usage.bytes ?? 0) > maximumBytes)) {
    throw new CollaborationCodecErrorV2("invalid-codec", `${kind} exceeds the frozen v2 capacity`)
  }
}

function capacity(kind: KernelCapacityKindV2): readonly [number, number | undefined] {
  switch (kind) {
    case "pending-document": return [KERNEL_LIMITS_V2.pendingInboxFramesPerDocument, KERNEL_LIMITS_V2.pendingInboxBytesPerDocument]
    case "pending-remote-actor": return [KERNEL_LIMITS_V2.pendingInboxFramesPerRemoteActor, KERNEL_LIMITS_V2.pendingInboxBytesPerRemoteActor]
    case "local-outbox-document": return [KERNEL_LIMITS_V2.localOutboxFramesPerDocument, KERNEL_LIMITS_V2.localOutboxBytesPerDocument]
    case "retained-durable-acks": return [KERNEL_LIMITS_V2.retainedDurableAcksPerFrame, undefined]
    case "project-quarantine": return [KERNEL_LIMITS_V2.quarantineObjectsPerProject, KERNEL_LIMITS_V2.quarantineBytesPerProject]
    case "local-recovery-branch": return [1, KERNEL_LIMITS_V2.localRecoveryBranchBytes]
  }
}

function assertSafeCount(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new CollaborationCodecErrorV2("invalid-codec", `${label} must be a nonnegative safe integer`)
}
