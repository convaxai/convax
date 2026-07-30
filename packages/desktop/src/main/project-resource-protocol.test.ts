import { describe, expect, mock, test } from "bun:test"
import {
  createProjectResourceUrl,
  createProjectResourceProtocolResponse,
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

  test("reports byte-range responses honestly so media elements can seek", async () => {
    const ranged = createProjectResourceProtocolResponse({
      cacheControl: "no-store",
      request: new Request("convax-asset://project-one/project-file", {
        headers: { Range: "bytes=1000-1999" },
      }),
      response: new Response(new Uint8Array(1_000), {
        headers: { "Content-Type": "video/mp4" },
        status: 200,
      }),
      size: 10_000,
    })

    expect(ranged.status).toBe(206)
    expect(ranged.headers.get("accept-ranges")).toBe("bytes")
    expect(ranged.headers.get("content-range")).toBe("bytes 1000-1999/10000")
    expect(ranged.headers.get("content-length")).toBe("1000")
    expect(ranged.headers.get("content-type")).toBe("video/mp4")
    expect(await ranged.arrayBuffer()).toHaveLength(1_000)
  })

  test("rejects unsupported ranges and preserves HEAD metadata without a body", async () => {
    const unsatisfiable = createProjectResourceProtocolResponse({
      cacheControl: "no-store",
      request: new Request("convax-asset://project-one/project-file", {
        headers: { Range: "bytes=10000-10001" },
      }),
      response: new Response(null, { status: 200 }),
      size: 10_000,
    })
    expect(unsatisfiable.status).toBe(416)
    expect(unsatisfiable.headers.get("content-range")).toBe("bytes */10000")

    const head = createProjectResourceProtocolResponse({
      cacheControl: "private, max-age=31536000, immutable",
      request: new Request("convax-asset://project-one/managed-asset", { method: "HEAD" }),
      response: new Response(new Uint8Array([1, 2, 3]), {
        headers: { "Content-Type": "image/png" },
        status: 200,
      }),
      size: 3,
    })
    expect(head.status).toBe(200)
    expect(head.headers.get("content-length")).toBe("3")
    expect(head.headers.get("cache-control")).toBe("private, max-age=31536000, immutable")
    expect(await head.arrayBuffer()).toHaveLength(0)
  })
})
