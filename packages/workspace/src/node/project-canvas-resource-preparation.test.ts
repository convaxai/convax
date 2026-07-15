import { describe, expect, test } from "bun:test"
import { projectFileReferenceKey } from "../project-resources"
import {
  ProjectCanvasResourcePreparation,
  type ProjectCanvasMediaInspector,
  type ProjectCanvasResourceHost,
} from "./project-canvas-resource-preparation"

const requestRef = { canvasId: "canvas_main", projectId: "project_one" }

describe("project canvas resource preparation", () => {
  test("prepares inline text and reads project text through the Project host", async () => {
    const readPaths: string[] = []
    const host: ProjectCanvasResourceHost = {
      async copyEntries() {
        throw new Error("Text resources must not be copied")
      },
      async readFileInfo(input) {
        readPaths.push(input.path)
        return {
          mimeType: "text/markdown; charset=utf-8",
          name: "brief.md",
          path: input.path,
          size: 14,
        }
      },
      async readTextFile(input) {
        readPaths.push(input.path)
        return { content: "# Project brief", exists: true, path: input.path }
      },
    }
    const preparation = new ProjectCanvasResourcePreparation(host)

    const result = await preparation.prepare({
      ...requestRef,
      sources: [
        { format: "plain", kind: "inline-text", sourceId: "inline", text: "Hello" },
        { kind: "project-file", path: "docs/brief.md", sourceId: "project-text" },
      ],
    })

    expect(result.items).toEqual([
      { format: "plain", id: "inline", kind: "text", name: undefined, text: "Hello" },
      {
        format: "markdown",
        id: "project-text",
        kind: "text",
        mimeType: "text/markdown",
        name: "brief.md",
        text: "# Project brief",
      },
    ])
    expect(readPaths).toEqual(["docs/brief.md", "docs/brief.md"])
  })

  test("copies project media into managed assets and uses the returned collision path", async () => {
    const readPaths: string[] = []
    const copyInputs: Array<{ destinationPath?: string; paths: string[] }> = []
    const host: ProjectCanvasResourceHost = {
      async copyEntries(input) {
        copyInputs.push({ destinationPath: input.destinationPath, paths: input.paths })
        return {
          affectedPaths: [".convax/assets/hero copy.png"],
          operation: "copy",
          projectId: input.projectId,
          sourcePaths: input.paths,
          targetPaths: [".convax/assets/hero copy.png"],
        }
      },
      async readFileInfo(input) {
        readPaths.push(input.path)
        return {
          mimeType: "image/png",
          name: input.path.endsWith("hero copy.png") ? "hero copy.png" : "hero.png",
          path: input.path,
          size: 42,
        }
      },
      async readTextFile() {
        throw new Error("Media resources must not be read as text")
      },
    }
    const preparation = new ProjectCanvasResourcePreparation(host)

    const result = await preparation.prepare({
      ...requestRef,
      sources: [{ kind: "project-file", path: "media\\hero.png", sourceId: "hero" }],
    })

    expect(copyInputs).toEqual([{ destinationPath: ".convax/assets", paths: ["media/hero.png"] }])
    expect(readPaths).toEqual(["media/hero.png", ".convax/assets/hero copy.png"])
    expect(result.items[0]).toMatchObject({
      id: "hero",
      kind: "image",
      metadata: { [projectFileReferenceKey]: { path: ".convax/assets/hero copy.png" } },
      mimeType: "image/png",
      name: "hero copy.png",
      url: "",
    })
  })

  test("reuses an existing managed asset and enriches media through the inspector", async () => {
    let copied = false
    const inspections: unknown[] = []
    const host: ProjectCanvasResourceHost = {
      async copyEntries() {
        copied = true
        throw new Error("Existing assets must not be copied")
      },
      async readFileInfo(input) {
        return {
          mimeType: "video/mp4",
          name: "clip.mp4",
          path: input.path,
          size: 1_024,
        }
      },
      async readTextFile() {
        throw new Error("Media resources must not be read as text")
      },
    }
    const inspector: ProjectCanvasMediaInspector = {
      async inspect(input) {
        inspections.push(input)
        return {
          durationMs: 2_400,
          height: 720,
          posterUrl: "convax-poster://clip",
          width: 1_280,
        }
      },
    }
    const preparation = new ProjectCanvasResourcePreparation(host, inspector)

    const result = await preparation.prepare({
      ...requestRef,
      sources: [{ kind: "project-file", path: ".convax/assets/clip.mp4", sourceId: "clip" }],
    })

    expect(copied).toBe(false)
    expect(inspections).toEqual([{
      kind: "video",
      mimeType: "video/mp4",
      name: "clip.mp4",
      path: ".convax/assets/clip.mp4",
      projectId: "project_one",
    }])
    expect(result.items[0]).toMatchObject({
      durationMs: 2_400,
      height: 720,
      kind: "video",
      posterUrl: "convax-poster://clip",
      url: "",
      width: 1_280,
    })
  })

  test("maps remote URLs by MIME type without touching the Project host", async () => {
    const host: ProjectCanvasResourceHost = {
      async copyEntries() {
        throw new Error("Remote resources must not use Project storage")
      },
      async readFileInfo() {
        throw new Error("Remote resources must not use Project storage")
      },
      async readTextFile() {
        throw new Error("Remote resources must not use Project storage")
      },
    }
    const preparation = new ProjectCanvasResourcePreparation(host)

    const result = await preparation.prepare({
      ...requestRef,
      sources: [
        { kind: "remote-url", mimeType: "audio/mpeg", sourceId: "audio", url: "https://example.com/song.mp3" },
        { kind: "remote-url", mimeType: "application/pdf", sourceId: "pdf", url: "https://example.com/spec.pdf" },
      ],
    })

    expect(result.items).toMatchObject([
      { id: "audio", kind: "audio", name: "song.mp3", url: "https://example.com/song.mp3" },
      { id: "pdf", kind: "file", name: "spec.pdf", url: "https://example.com/spec.pdf" },
    ])
  })

  test("rejects remote URLs outside HTTP and HTTPS", async () => {
    const preparation = new ProjectCanvasResourcePreparation(unusedHost())

    await expect(preparation.prepare({
      ...requestRef,
      sources: [{ kind: "remote-url", sourceId: "local", url: "file:///tmp/secret.png" }],
    })).rejects.toThrow("HTTP or HTTPS")
  })

  test.each([
    "C:\\Users\\someone\\image.png",
    "\\\\server\\share\\image.png",
    "..\\outside.png",
    "media/CON.png",
    "media/trailing. ",
  ])("rejects non-portable project paths: %s", async (path) => {
    const preparation = new ProjectCanvasResourcePreparation(unusedHost())

    await expect(preparation.prepare({
      ...requestRef,
      sources: [{ kind: "project-file", path, sourceId: "unsafe" }],
    })).rejects.toThrow(/Invalid portable project path|Project path escapes its root/)
  })

  test.each([
    ".convax/project.json",
    ".convax/canvases/canvas-main/document.json",
    ".CONVAX/assets/image.png",
  ])("rejects project private storage as a resource: %s", async (path) => {
    const preparation = new ProjectCanvasResourcePreparation(unusedHost())

    await expect(preparation.prepare({
      ...requestRef,
      sources: [{ kind: "project-file", path, sourceId: "private" }],
    })).rejects.toThrow("Project private storage")
  })
})

function unusedHost(): ProjectCanvasResourceHost {
  return {
    async copyEntries() {
      throw new Error("Invalid resources must not use Project storage")
    },
    async readFileInfo() {
      throw new Error("Invalid resources must not use Project storage")
    },
    async readTextFile() {
      throw new Error("Invalid resources must not use Project storage")
    },
  }
}
