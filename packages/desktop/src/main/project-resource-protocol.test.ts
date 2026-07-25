import { describe, expect, mock, test } from "bun:test"
import {
  createProjectResourceUrl,
  parseProjectResourceUrl,
  resolveProjectResourceProtocolPath,
} from "./project-resource-protocol"

describe("Project resource protocol", () => {
  test("round trips typed Project files with runtime revisions and no native path", () => {
    const url = createProjectResourceUrl({
      contentRevision: "a".repeat(64),
      projectId: "project-one",
      reference: { kind: "project-file", path: "Media/hero.png" },
    })

    expect(url).toBe(
      `convax-asset://project-one/project-file?path=Media%2Fhero.png&revision=${"a".repeat(64)}`,
    )
    expect(parseProjectResourceUrl(url)).toEqual({
      contentRevision: "a".repeat(64),
      projectId: "project-one",
      reference: { kind: "project-file", path: "Media/hero.png" },
    })
    expect(url).not.toContain("/native/")
  })

  test("round trips immutable managed references without exposing .convax", () => {
    const reference = {
      kind: "managed-asset" as const,
      mediaType: "image/png",
      name: "hero.png",
      sha256: "b".repeat(64),
    }
    const url = createProjectResourceUrl({ projectId: "project-one", reference })

    expect(parseProjectResourceUrl(url)).toEqual({ projectId: "project-one", reference })
    expect(url).not.toContain(".convax")
    expect(url).not.toContain("/native/")
  })

  test("rejects private, malformed, and path-only protocol requests", () => {
    for (const url of [
      "convax-asset://project-one/file?path=Media/hero.png",
      "convax-asset://project-one/project-file?path=.convax/project.json&revision=" + "a".repeat(64),
      "convax-asset://project-one/project-file?path=Media/hero.png",
      "convax-asset://project-one/project-file?path=Media/hero.png&revision=bad",
      "convax-asset://project-one/managed-asset?sha256=" + "b".repeat(64),
      "convax-asset://user@project-one/project-file?path=hero.png&revision=" + "a".repeat(64),
    ]) {
      expect(() => parseProjectResourceUrl(url)).toThrow()
    }
  })

  test("revalidates each typed reference through its owning Node capability", async () => {
    const resolveEntryPath = mock(async () => "/native/project/Media/hero.png")
    const resolve = mock(async () => "/native/project/.convax/assets/blobs/digest")

    await expect(
      resolveProjectResourceProtocolPath(
        createProjectResourceUrl({
          contentRevision: "a".repeat(64),
          projectId: "project-one",
          reference: { kind: "project-file", path: "Media/hero.png" },
        }),
        { resolveEntryPath },
        { resolve },
      ),
    ).resolves.toMatchObject({ kind: "project-file" })
    expect(resolveEntryPath).toHaveBeenCalledWith({ path: "Media/hero.png", projectId: "project-one" })

    const managed = {
      kind: "managed-asset" as const,
      name: "hero.png",
      sha256: "b".repeat(64),
    }
    await expect(
      resolveProjectResourceProtocolPath(
        createProjectResourceUrl({ projectId: "project-one", reference: managed }),
        { resolveEntryPath },
        { resolve },
      ),
    ).resolves.toMatchObject({ kind: "managed-asset" })
    expect(resolve).toHaveBeenCalledWith({ projectId: "project-one", reference: managed })
  })
})
