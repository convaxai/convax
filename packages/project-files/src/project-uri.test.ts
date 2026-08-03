import { describe, expect, test } from "bun:test"
import { UriParseError } from "@convax/uri"
import { parseProjectFileId, parseProjectVersionId } from "./identity"
import { equalsProjectEntryUri, fromProjectEntryUri, parseProjectEntryUri } from "./project-uri"

const projectId = "project_0123456789abcdef0123456789abcdef"
const projectEpoch = "AQEBAQEBAQEBAQEBAQEBAQ"
const entryId = `pf_${"a".repeat(64)}` as const

describe("Project entry URI contract", () => {
  test("keeps stable identity, path hint and immutable blob in one canonical value", () => {
    const uri = fromProjectEntryUri({
      projectId,
      projectEpoch,
      entryId,
      path: "Generated/clip.mp4",
      blob: `sha256:${"b".repeat(64)}`,
    })
    expect(parseProjectEntryUri(uri)).toEqual({
      projectId,
      projectEpoch,
      entryId,
      path: "Generated/clip.mp4",
      blob: `sha256:${"b".repeat(64)}`,
    })
    const renamed = fromProjectEntryUri({
      projectId,
      projectEpoch,
      entryId,
      path: "Generated/renamed.mp4",
      blob: `sha256:${"b".repeat(64)}`,
    })
    const changedBytes = fromProjectEntryUri({
      projectId,
      projectEpoch,
      entryId,
      path: "Generated/renamed.mp4",
      blob: `sha256:${"c".repeat(64)}`,
    })
    expect(equalsProjectEntryUri(uri, renamed, "entry")).toBeTrue()
    expect(equalsProjectEntryUri(uri, renamed, "entry-revision")).toBeTrue()
    expect(equalsProjectEntryUri(uri, renamed, "canonical-string")).toBeFalse()
    expect(equalsProjectEntryUri(uri, changedBytes, "entry")).toBeTrue()
    expect(equalsProjectEntryUri(uri, changedBytes, "entry-revision")).toBeFalse()
  })

  test("rejects a path-only reference and never treats the path as identity", () => {
    expect(() =>
      parseProjectEntryUri(`convax-project://${projectId}/epochs/${projectEpoch}/entries/Generated%2Fclip.mp4`),
    ).toThrow(UriParseError)
  })

  test("keeps file id, URI location, version id, and blob identity distinct", () => {
    const fileId = parseProjectFileId(entryId)
    const versionId = parseProjectVersionId(`pv_${"c".repeat(64)}`)
    const blob = `sha256:${"d".repeat(64)}` as const
    const uri = fromProjectEntryUri({
      projectId,
      projectEpoch,
      entryId: fileId,
      path: "Notes/renamed.md",
      blob,
    })

    expect(parseProjectEntryUri(uri)).toMatchObject({ blob, entryId: fileId, path: "Notes/renamed.md" })
    expect(uri.toString()).not.toContain(versionId)
    expect(versionId).not.toBe(fileId)
    expect(blob).not.toContain(fileId)
  })
})
