import { afterEach, describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import {
  encodeRestrictedJcs,
  parseDigest,
  parseId128,
  parseProjectId,
  parseSignature,
} from "@convax/collaboration"
import {
  projectResetConfirmationCoreDigest,
  type ProjectResetConfirmationCore,
} from "../../collaboration-protocol/project-reset"
import { readProjectResetRecords, writeProjectResetRecords, type ProjectResetRecords } from "./project-reset-store"

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { force: true, recursive: true })))
})

describe.skipIf(process.platform === "win32")("Project reset record store real-filesystem durability", () => {
  test("repairs an exact fsynced envelope transition left before atomic rename", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "convax-reset-records-"))
    roots.push(directory)
    const staged = records("reset-staged")
    await writeProjectResetRecords(directory, staged)
    expect(await fs.readdir(directory)).toEqual(["project-reset-records-v2.jcs"])

    const authorized = records("reset-authorized")
    await fs.writeFile(
      path.join(directory, "project-reset-records-v2.jcs.next"),
      encodeRestrictedJcs(authorized),
    )
    await writeProjectResetRecords(directory, authorized)
    expect((await readProjectResetRecords(directory)).manifest.state).toBe("reset-authorized")
    expect(await fs.readdir(directory)).toEqual(["project-reset-records-v2.jcs"])
  })
})

function records(state: ProjectResetRecords["manifest"]["state"]): ProjectResetRecords {
  const id = parseId128("AQEBAQEBAQEBAQEBAQEBAQ")
  const digest = parseDigest("11".repeat(32))
  const bindingDigest = parseDigest("22".repeat(32))
  const core: ProjectResetConfirmationCore = Object.freeze({
    format: "convax.project-reset-confirmation-core",
    resetId: id,
    confirmationId: id,
    projectId: parseProjectId("project_reset_store"),
    oldProjectEpoch: null,
    reason: "unsupported-portable-version",
    observedOldPrivateTreeDigest: digest,
    unsupportedInventoryDigest: digest,
    privateDeletionSetDigest: digest,
    stableProjectIdPreserved: true,
    ordinaryProjectFilesPreserved: true,
    deletionStatement: "delete-exact-displayed-private-project-state",
    requestedProtocolDigest: digest,
    requestedSchemaDigest: digest,
    requestedUriProtocolDigest: digest,
    confirmationPrincipal: Object.freeze({
      kind: "local-project-owner",
      localProjectBindingDigest: bindingDigest,
      localConfirmationKeyId: "local-owner-test",
    }),
    protocolDigest: digest,
  })
  const coreDigest = projectResetConfirmationCoreDigest(core)
  return Object.freeze({
    format: "convax.project-reset-records",
    confirmation: Object.freeze({
      format: "convax.project-reset-confirmation",
      core,
      coreDigest,
      confirmationSignature: parseSignature(Buffer.alloc(64, 3).toString("base64url")),
    }),
    manifest: Object.freeze({
      format: "convax.project-reset-manifest",
      resetId: id,
      projectId: core.projectId,
      oldProjectEpoch: null,
      newProjectEpoch: id,
      newMembershipEpoch: null,
      newProjectIndexShardEpoch: id,
      reason: core.reason,
      observedOldPrivateTreeDigest: digest,
      unsupportedInventoryDigest: digest,
      privateDeletionSetDigest: digest,
      requestedProtocolDigest: digest,
      requestedSchemaDigest: digest,
      requestedUriProtocolDigest: digest,
      emptyProjectIndexCheckpointDigest: digest,
      emptyProjectIndexFullUpdateDigest: digest,
      emptyProjectIndexStateVectorDigest: digest,
      emptyProjectIndexCanonicalStateDigest: digest,
      projectResetConfirmationCoreDigest: coreDigest,
      projectResetApprovalCoreDigest: null,
      teamEpochRolloverRequestDigest: null,
      emptyProjectIndexGenesisAttestationCoreDigest: null,
      teamEpochRolloverReceiptCoreDigest: null,
      state,
    }),
  })
}
