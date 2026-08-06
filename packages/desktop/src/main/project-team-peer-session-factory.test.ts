import { describe, expect, mock, test } from "bun:test"
import { getEventListeners } from "node:events"
import {
  encodeBase64url,
  parseDigest,
  parseId128,
  parseMemberId,
  parseProjectId,
  parsePublicKey,
  parseSignature,
} from "@convax/collaboration"

import type { DesktopCollaborationControlHttpClient } from "./collaboration-control-http-client"
import type { DesktopTeamAuthorityRecord, VerifiedDesktopTeamAuthority } from "./durable-team-authority-store"
import { ProductionProjectTeamPeerSessionFactory, waitForTeamRetry } from "./project-team-peer-session-factory"

const id = (fill: number) => parseId128(encodeBase64url(new Uint8Array(16).fill(fill)))
const projectId = parseProjectId("project-team-factory")
const memberId = parseMemberId(id(2))
const publicKey = parsePublicKey(encodeBase64url(new Uint8Array(32).fill(3)))
const signature = parseSignature(encodeBase64url(new Uint8Array(64).fill(4)))
const digest = (fill: string) => parseDigest(fill.repeat(64))
const invitation = Object.freeze({
  invitationToken: encodeBase64url(new Uint8Array(16).fill(5)),
  projectId,
  initialRole: "editor" as const,
  expiresAtUnixMs: "9999999999999" as const,
})

describe("ProductionProjectTeamPeerSessionFactory", () => {
  test("removes the retry abort listener on both timeout and cancellation", async () => {
    const resolved = new AbortController()
    await waitForTeamRetry(0, resolved.signal)
    expect(getEventListeners(resolved.signal, "abort")).toHaveLength(0)

    const cancelled = new AbortController()
    const waiting = waitForTeamRetry(60_000, cancelled.signal)
    expect(getEventListeners(cancelled.signal, "abort")).toHaveLength(1)
    cancelled.abort(new DOMException("cancelled", "AbortError"))
    await expect(waiting).rejects.toThrow("cancelled")
    expect(getEventListeners(cancelled.signal, "abort")).toHaveLength(0)
  })

  test("binds bootstrap to verified native facts, publishes authority, provisions, barriers writer, then opens", async () => {
    const record = { projectId } as DesktopTeamAuthorityRecord
    const admitted = { record } as VerifiedDesktopTeamAuthority
    const install = mock(async () => undefined)
    const provision = mock(async () => ({ record, state: "active-editor" as const }))
    const barrier = mock(async () => undefined)
    const open = mock(async () => session())
    const bootstrapTeam = mock(async (_input: unknown) => ({ status: "ok" as const, value: {
      membershipSnapshot: {}, ownerCredential: {}, ownerAdminCapability: {}, invitation,
      initialization: { projectId, ...nativeFacts() },
    } }))
    const factory = new ProductionProjectTeamPeerSessionFactory({
      control: { bootstrapTeam } as unknown as DesktopCollaborationControlHttpClient,
      teamAdmission: { admit: mock(async () => admitted) },
      teamStore: { open: mock(async () => "missing" as const), install },
      memberIdentity: { resolve: mock(async () => memberId) },
      memberVault: { ensureMemberKey: mock(async () => ({ publicKey, signer: { sign: mock(async () => signature) } })) },
      nativeFacts: { resolve: mock(async () => ({ projectId, ...nativeFacts() })) },
      provisioner: { provision }, sessions: { open },
      protocolDigest: digest("a"), trustBundleDigest: digest("b"), createId: () => id(9),
      afterAuthorityChange: barrier,
    })

    const result = await factory.bootstrapTeam({ projectId, signal: new AbortController().signal })
    expect(result.invitation).toEqual(invitation)
    expect(result.session.status).toBe("ready")
    expect(bootstrapTeam).toHaveBeenCalledWith(expect.objectContaining({ projectId,
      ownerMemberId: memberId, projectEpoch: id(10), projectIndexShardEpoch: id(11) }))
    expect(install).toHaveBeenCalledWith(admitted)
    expect(provision).toHaveBeenCalledWith(record, expect.any(AbortSignal))
    expect(barrier).toHaveBeenCalledWith(projectId)
    expect(open).toHaveBeenCalledWith({ record, signal: expect.any(AbortSignal) })
  })

  test("retries a lost bootstrap response with byte-identical authority input and installs only the recovered Team graph", async () => {
    const record = { projectId } as DesktopTeamAuthorityRecord
    const admitted = { record } as VerifiedDesktopTeamAuthority
    const membershipSnapshot = Object.freeze({ coreDigest: digest("c") })
    const ownerCredential = Object.freeze({ coreDigest: digest("d") })
    const ownerAdminCapability = Object.freeze({ coreDigest: digest("e") })
    const recovered = Object.freeze({
      membershipSnapshot,
      ownerCredential,
      ownerAdminCapability,
      invitation,
      initialization: Object.freeze({ projectId, ...nativeFacts() }),
    })
    const requests: unknown[] = []
    const bootstrapTeam = mock(async (request: unknown) => {
      requests.push(request)
      if (requests.length === 1) throw new TypeError("response stream closed after commit")
      return { status: "ok" as const, value: recovered }
    })
    const install = mock(async () => undefined)
    const admit = mock(async (candidate: unknown) => {
      expect(candidate).toEqual({
        membershipSnapshot,
        memberCredential: ownerCredential,
        adminCapability: ownerAdminCapability,
        replicaActorCredential: null,
        replicaEditAuthorization: null,
      })
      return admitted
    })
    const factory = new ProductionProjectTeamPeerSessionFactory({
      control: { bootstrapTeam } as unknown as DesktopCollaborationControlHttpClient,
      teamAdmission: { admit },
      teamStore: { open: mock(async () => "missing" as const), install },
      memberIdentity: { resolve: mock(async () => memberId) },
      memberVault: { ensureMemberKey: mock(async () => ({ publicKey, signer: { sign: mock(async () => signature) } })) },
      nativeFacts: { resolve: mock(async () => ({ projectId, ...nativeFacts() })) },
      provisioner: { provision: mock(async () => ({ record, state: "active-editor" as const })) },
      sessions: { open: mock(async () => session()) },
      protocolDigest: digest("a"), trustBundleDigest: digest("b"), createId: () => id(9),
      afterAuthorityChange: mock(async () => undefined),
    })
    const signal = new AbortController().signal

    await expect(factory.bootstrapTeam({ projectId, signal })).rejects.toThrow("response stream closed after commit")
    expect(install).not.toHaveBeenCalled()
    await expect(factory.bootstrapTeam({ projectId, signal })).resolves.toMatchObject({ invitation, session: { status: "ready" } })

    expect(requests).toHaveLength(2)
    expect(requests[1]).toEqual(requests[0])
    expect(admit).toHaveBeenCalledTimes(1)
    expect(install).toHaveBeenCalledTimes(1)
    expect(install).toHaveBeenCalledWith(admitted)
  })

  test("never calls network for an unteamed open and exposes pending floor as explicit attention", async () => {
    const control = { bootstrapTeam: mock(() => { throw new Error("must not call") }) } as unknown as DesktopCollaborationControlHttpClient
    const missing = factoryFixture({ control, open: "missing" })
    await expect(missing.openExisting({ projectId, signal: new AbortController().signal })).resolves.toEqual({ status: "local-only" })

    const record = { projectId } as DesktopTeamAuthorityRecord
    const pending = factoryFixture({ control, open: record, provisionState: "pending-floor" })
    await expect(pending.openExisting({ projectId, signal: new AbortController().signal })).resolves.toEqual({
      status: "attention", reason: "floor-installation-pending",
    })
  })
})

function factoryFixture(input: {
  control: DesktopCollaborationControlHttpClient
  open: DesktopTeamAuthorityRecord | "missing"
  provisionState?: "active-editor" | "pending-floor"
}) {
  const record = input.open === "missing" ? ({ projectId } as DesktopTeamAuthorityRecord) : input.open
  const admitted = { record } as VerifiedDesktopTeamAuthority
  return new ProductionProjectTeamPeerSessionFactory({
    control: input.control,
    teamAdmission: { admit: async () => admitted },
    teamStore: { open: async () => input.open, install: async () => undefined },
    memberIdentity: { resolve: async () => memberId },
    memberVault: { ensureMemberKey: async () => ({ publicKey, signer: { sign: async () => signature } }) },
    nativeFacts: { resolve: async () => ({ projectId, ...nativeFacts() }) },
    provisioner: { provision: async () => ({ record, state: input.provisionState ?? "active-editor" }) },
    sessions: { open: async () => session() },
    protocolDigest: digest("a"), trustBundleDigest: digest("b"), createId: () => id(9),
    afterAuthorityChange: async () => undefined,
  })
}

function nativeFacts() {
  return Object.freeze({
    projectEpoch: id(10), projectIndexShardEpoch: id(11), initializationAuthorityDigest: digest("1"),
    initialProjectIndexCheckpointDigest: digest("2"), initialProjectIndexFullUpdateDigest: digest("3"),
    initialProjectIndexStateVectorDigest: digest("4"), initialProjectIndexCanonicalStateDigest: digest("5"),
  })
}

function session() {
  return Object.freeze({
    projectId,
    snapshot: () => ({ state: "online" as const, canEdit: true, connectedPeerCount: 0, reason: null }),
    subscribe: () => () => undefined,
    setOnline: () => undefined,
    quiesce: async () => undefined,
  })
}
