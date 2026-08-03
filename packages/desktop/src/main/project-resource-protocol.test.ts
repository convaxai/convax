import { describe, expect, test } from "bun:test"
import {
  createProjectResourceUrl,
  createProjectResourceProtocolResponse,
  parseProjectResourceUrl,
  projectResourceAccessControlAllowOrigin,
} from "./project-resource-protocol"

describe("Project resource protocol", () => {
  test("grants pixel-readable image responses only to the exact trusted renderer", () => {
    expect(
      projectResourceAccessControlAllowOrigin(
        new Request("convax-asset://project-one/project-file", {
          headers: { Origin: "http://localhost:5173" },
        }),
        "http://localhost:5173/",
      ),
    ).toBe("http://localhost:5173")
    expect(
      projectResourceAccessControlAllowOrigin(
        new Request("convax-asset://project-one/project-file", {
          headers: { Origin: "https://untrusted.example" },
        }),
        "http://localhost:5173/",
      ),
    ).toBeUndefined()
    expect(
      projectResourceAccessControlAllowOrigin(
        new Request("convax-asset://project-one/project-file", {
          headers: {
            Origin: "null",
            Referer: "file:///Applications/Convax/resources/app.asar/out/renderer/index.html",
          },
        }),
        "file:///Applications/Convax/resources/app.asar/out/renderer/index.html",
      ),
    ).toBe("null")
  })

  test("round trips typed Project files with runtime revisions and no native path", () => {
    const url = createProjectResourceUrl({
      contentRevision: "a".repeat(64),
      projectId: "project-one",
      reference: { kind: "project-file", path: "Media/hero.png" },
    })

    expect(url).toBe(`convax-asset://project-one/project-file?path=Media%2Fhero.png&revision=${"a".repeat(64)}`)
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

  test("reports byte-range responses honestly so media elements can seek", async () => {
    const ranged = createProjectResourceProtocolResponse({
      accessControlAllowOrigin: "https://convax.example",
      cacheControl: "no-store",
      request: new Request("convax-asset://project-one/project-file", {
        headers: { Range: "bytes=1000-1999" },
      }),
      resource: {
        body: new Response(new Uint8Array(1_000)).body!,
        contentLength: 1_000,
        contentRange: { end: 1_999, start: 1_000 },
        kind: "project-file",
        mediaType: "video/mp4",
        size: 10_000,
        status: "ready",
      },
    })

    expect(ranged.status).toBe(206)
    expect(ranged.headers.get("accept-ranges")).toBe("bytes")
    expect(ranged.headers.get("content-range")).toBe("bytes 1000-1999/10000")
    expect(ranged.headers.get("content-length")).toBe("1000")
    expect(ranged.headers.get("content-type")).toBe("video/mp4")
    expect(ranged.headers.get("access-control-allow-origin")).toBe("https://convax.example")
    expect(ranged.headers.get("vary")).toBe("Origin")
    expect(await ranged.arrayBuffer()).toHaveLength(1_000)
  })

  test("rejects unsupported ranges and preserves HEAD metadata without a body", async () => {
    const unsatisfiable = createProjectResourceProtocolResponse({
      cacheControl: "no-store",
      request: new Request("convax-asset://project-one/project-file", {
        headers: { Range: "bytes=10000-10001" },
      }),
      resource: {
        kind: "project-file",
        mediaType: "video/mp4",
        size: 10_000,
        status: "range-not-satisfiable",
      },
    })
    expect(unsatisfiable.status).toBe(416)
    expect(unsatisfiable.headers.get("content-range")).toBe("bytes */10000")

    const head = createProjectResourceProtocolResponse({
      cacheControl: "private, max-age=31536000, immutable",
      request: new Request("convax-asset://project-one/managed-asset", { method: "HEAD" }),
      resource: {
        body: new Response(new Uint8Array([1, 2, 3])).body!,
        contentLength: 3,
        kind: "managed-asset",
        mediaType: "image/png",
        size: 3,
        status: "ready",
      },
    })
    expect(head.status).toBe(200)
    expect(head.headers.get("content-length")).toBe("3")
    expect(head.headers.get("cache-control")).toBe("private, max-age=31536000, immutable")
    expect(await head.arrayBuffer()).toHaveLength(0)
  })
})
