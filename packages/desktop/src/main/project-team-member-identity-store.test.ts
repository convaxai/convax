import { describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { encodeBase64url, parseId128, parseMemberId, parseProjectId } from "@convax/collaboration"

import { NodeProjectTeamMemberIdentityStoreV1 } from "./project-team-member-identity-store"

describe("NodeProjectTeamMemberIdentityStoreV1", () => {
  test("publishes one stable per-Project identity and reopens canonical bytes", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "convax-member-id-"))
    const memberId = parseMemberId(parseId128(encodeBase64url(new Uint8Array(16).fill(1))))
    const store = new NodeProjectTeamMemberIdentityStoreV1(path.join(root, "ids"), () => memberId)
    const projectId = parseProjectId("project-a")
    expect(await store.resolve(projectId)).toBe(memberId)
    expect(await new NodeProjectTeamMemberIdentityStoreV1(path.join(root, "ids")).resolve(projectId)).toBe(memberId)
    expect(await fs.readdir(path.join(root, "ids"))).toHaveLength(1)
  })
})
