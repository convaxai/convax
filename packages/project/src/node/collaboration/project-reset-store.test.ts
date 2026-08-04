import { afterEach, describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import {
  encodeRestrictedJcsV2,
  parseDigestV2,
  parseId128V2,
  parseProjectIdV2,
  parseSignatureV2,
} from "@convax/collaboration"
import {
  projectResetConfirmationCoreDigestV2,
  type ProjectResetConfirmationCoreV2,
} from "../../collaboration-protocol/project-reset"
import { readProjectResetRecordsV2, writeProjectResetRecordsV2, type ProjectResetRecordsV2 } from "./project-reset-store"

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { force: true, recursive: true })))
})

describe.skipIf(process.platform === "win32")("Project reset record store real-filesystem durability", () => {
  test("repairs an exact fsynced envelope transition left before atomic rename", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "convax-reset-records-"))
    roots.push(directory)
    const staged = records("reset-staged")
    await writeProjectResetRecordsV2(directory, staged)
    expect(await fs.readdir(directory)).toEqual(["project-reset-records-v2.jcs"])

    const authorized = records("reset-authorized")
    await fs.writeFile(
      path.join(directory, "project-reset-records-v2.jcs.next"),
      encodeRestrictedJcsV2(authorized),
    )
    await writeProjectResetRecordsV2(directory, authorized)
    expect((await readProjectResetRecordsV2(directory)).manifest.state).toBe("reset-authorized")
    expect(await fs.readdir(directory)).toEqual(["project-reset-records-v2.jcs"])
  })
})

function records(state: ProjectResetRecordsV2["manifest"]["state"]): ProjectResetRecordsV2 {
  const id = parseId128V2("AQEBAQEBAQEBAQEBAQEBAQ")
  const digest = parseDigestV2("11".repeat(32))
  const bindingDigest = parseDigestV2("22".repeat(32))
  const core: ProjectResetConfirmationCoreV2 = Object.freeze({
    format: "convax.project-reset-confirmation-core/2",
    resetId: id,
    confirmationId: id,
    projectId: parseProjectIdV2("project_reset_store"),
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
  const coreDigest = projectResetConfirmationCoreDigestV2(core)
  return Object.freeze({
    format: "convax.project-reset-records/2",
    confirmation: Object.freeze({
      format: "convax.project-reset-confirmation/2",
      core,
      coreDigest,
      confirmationSignature: parseSignatureV2(Buffer.alloc(64, 3).toString("base64url")),
    }),
    manifest: Object.freeze({
      format: "convax.project-reset-manifest/2",
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
