import { afterEach, describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import {
  JianyingDeepLinkDispatchError,
  MacOSJianyingDeepLinkTransport,
  openMacOSJianyingDeepLink,
  type JianyingDeepLinkMedia,
} from "./jianying-deeplink"

const temporaryRoots: string[] = []

interface FeatureEntry {
  enter_from: string
  extension: Record<string, never>
  feature: string
  feature_context: {
    material_import: boolean
    material_infos: Array<{
      material_param: { add_to_material_panel: boolean }
      material_uri: string
    }>
  }
  sence: string
  sence_context?: { material_import_by_user: boolean; new_draft: boolean }
}

async function temporaryRoot() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "convax-jianying-deeplink-"))
  temporaryRoots.push(root)
  return root
}

async function stagedMedia(
  root: string,
  name: string,
  content: string,
  mediaType: "image" | "video",
  mimeType: string,
): Promise<JianyingDeepLinkMedia> {
  const filePath = path.join(root, name)
  await fs.writeFile(filePath, content)
  return { mediaType, mimeType, name, path: filePath }
}

function decodeFeatureEntry(deepLink: string) {
  const url = new URL(deepLink)
  expect(url.protocol).toBe("videocut:")
  expect(url.hostname).toBe("com.ies.videocut")
  expect(url.pathname).toBe("/uganchor/anchor_point/nothing")
  const encoded = url.searchParams.get("featureEntry")
  if (!encoded) throw new Error("Missing featureEntry")
  const value: unknown = JSON.parse(encoded)
  if (!isFeatureEntry(value)) throw new Error("Invalid featureEntry")
  return value
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isFeatureEntry(value: unknown): value is FeatureEntry {
  if (!isRecord(value) || !isRecord(value.feature_context)) return false
  const context = value.feature_context
  const materialInfos = context.material_infos
  if (!Array.isArray(materialInfos)) return false
  return (
    typeof value.enter_from === "string" &&
    isRecord(value.extension) &&
    typeof value.feature === "string" &&
    context.material_import === true &&
    materialInfos.every(
      (item) =>
        isRecord(item) &&
        typeof item.material_uri === "string" &&
        isRecord(item.material_param) &&
        typeof item.material_param.add_to_material_panel === "boolean",
    ) &&
    typeof value.sence === "string" &&
    (value.sence_context === undefined ||
      (isRecord(value.sence_context) &&
        typeof value.sence_context.material_import_by_user === "boolean" &&
        typeof value.sence_context.new_draft === "boolean"))
  )
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => fs.rm(root, { force: true, recursive: true })))
})

describe("MacOSJianyingDeepLinkTransport", () => {
  test("encodes a current-draft multi-media import and transfers Chinese-named files over IPv4 loopback", async () => {
    const root = await temporaryRoot()
    const image = await stagedMedia(root, "封面 图片.jpg", "jpeg-content", "image", "image/jpeg")
    const video = await stagedMedia(root, "片段-一.mp4", "video-content", "video", "video/mp4")
    let featureEntry: FeatureEntry | undefined
    const transport = new MacOSJianyingDeepLinkTransport({
      openDeepLink: async (deepLink) => {
        featureEntry = decodeFeatureEntry(deepLink)
        const requests = featureEntry.feature_context.material_infos.map(async ({ material_uri }, index) => {
          const mediaUrl = new URL(material_uri)
          expect(mediaUrl.hostname).toBe("127.0.0.1")
          const segments = mediaUrl.pathname.split("/")
          expect(segments[1]).toBe("media")
          expect(segments[2]).toMatch(/^[a-f0-9]{64}$/)
          expect(decodeURIComponent(segments[3])).toBe(index === 0 ? image.name : video.name)
          const response = await fetch(material_uri)
          expect(response.status).toBe(200)
          expect(response.headers.get("accept-ranges")).toBe("bytes")
          expect(response.headers.get("content-type")).toBe(index === 0 ? "image/jpeg" : "video/mp4")
          expect(response.headers.get("content-length")).toBe(String(index === 0 ? 12 : 13))
          return response.text()
        })
        expect(await Promise.all(requests)).toEqual(["jpeg-content", "video-content"])
      },
    })

    const evidence = await transport.dispatchMaterialImport({ media: [image, video], target: "current" })

    expect(featureEntry).toEqual({
      enter_from: "agent",
      extension: {},
      feature: "nothing",
      feature_context: {
        material_import: true,
        material_infos: [
          {
            material_param: { add_to_material_panel: true },
            material_uri: expect.stringMatching(/^http:\/\/127\.0\.0\.1:\d+\/media\/[a-f0-9]{64}\//),
          },
          {
            material_param: { add_to_material_panel: true },
            material_uri: expect.stringMatching(/^http:\/\/127\.0\.0\.1:\d+\/media\/[a-f0-9]{64}\//),
          },
        ],
      },
      sence: "editor",
      sence_context: { material_import_by_user: true, new_draft: false },
    })
    if (!featureEntry) throw new Error("Expected featureEntry")
    const tokens = featureEntry.feature_context.material_infos.map(
      ({ material_uri }) => new URL(material_uri).pathname.split("/")[2],
    )
    expect(new Set(tokens).size).toBe(2)
    expect(evidence).toEqual({
      deepLinkDispatched: true,
      items: [
        {
          bytes: 12,
          completed: true,
          mediaType: "image",
          mimeType: "image/jpeg",
          name: image.name,
          size: 12,
          successfulTransfers: 1,
        },
        {
          bytes: 13,
          completed: true,
          mediaType: "video",
          mimeType: "video/mp4",
          name: video.name,
          size: 13,
          successfulTransfers: 1,
        },
      ],
      target: "current",
    })
  })

  test("uses JianYing's force-create route independently from material import", async () => {
    const opened: string[] = []
    const transport = new MacOSJianyingDeepLinkTransport({
      openDeepLink: async (deepLink) => {
        opened.push(deepLink)
      },
    })

    await transport.createDraft()

    expect(opened).toEqual(["videocut://com.ies.videocut/main/draft/new_draft?force_create=true"])
  })

  test("supports HEAD and single byte ranges while rejecting invalid routes and methods", async () => {
    const root = await temporaryRoot()
    const video = await stagedMedia(root, "range.mp4", "01234567", "video", "video/mp4")
    const transport = new MacOSJianyingDeepLinkTransport({
      openDeepLink: async (deepLink) => {
        const mediaUrl = decodeFeatureEntry(deepLink).feature_context.material_infos[0].material_uri

        const head = await fetch(mediaUrl, { headers: { Range: "bytes=2-5" }, method: "HEAD" })
        expect(head.status).toBe(206)
        expect(head.headers.get("content-range")).toBe("bytes 2-5/8")
        expect(head.headers.get("content-length")).toBe("4")
        expect(await head.text()).toBe("")

        const invalidRange = await fetch(mediaUrl, { headers: { Range: "bytes=0-1,3-4" } })
        expect(invalidRange.status).toBe(416)
        expect(invalidRange.headers.get("content-range")).toBe("bytes */8")
        const outsideRange = await fetch(mediaUrl, { headers: { Range: "bytes=99-" } })
        expect(outsideRange.status).toBe(416)

        const unknown = new URL(mediaUrl)
        unknown.pathname = "/not-a-token"
        expect((await fetch(unknown)).status).toBe(404)
        const wrongMethod = await fetch(mediaUrl, { method: "POST" })
        expect(wrongMethod.status).toBe(405)
        expect(wrongMethod.headers.get("allow")).toBe("GET, HEAD")

        const middle = await fetch(mediaUrl, { headers: { Range: "bytes=2-5" } })
        expect(middle.status).toBe(206)
        expect(middle.headers.get("content-type")).toBe("video/mp4")
        expect(await middle.text()).toBe("2345")
        const suffix = await fetch(mediaUrl, { headers: { Range: "bytes=-2" } })
        expect(suffix.status).toBe(206)
        expect(await suffix.text()).toBe("67")
        const prefix = await fetch(mediaUrl, { headers: { Range: "bytes=0-1" } })
        expect(prefix.status).toBe(206)
        expect(await prefix.text()).toBe("01")
      },
    })

    expect(await transport.dispatchMaterialImport({ media: [video], target: "current" })).toEqual({
      deepLinkDispatched: true,
      items: [
        {
          bytes: 8,
          completed: true,
          mediaType: "video",
          mimeType: "video/mp4",
          name: "range.mp4",
          size: 8,
          successfulTransfers: 3,
        },
      ],
      target: "current",
    })
  })

  test("times out with per-item evidence and closes the loopback server", async () => {
    const root = await temporaryRoot()
    const first = await stagedMedia(root, "first.png", "first", "image", "image/png")
    const second = await stagedMedia(root, "second.png", "second", "image", "image/png")
    let unrequestedUrl = ""
    const transport = new MacOSJianyingDeepLinkTransport({
      openDeepLink: async (deepLink) => {
        const infos = decodeFeatureEntry(deepLink).feature_context.material_infos
        expect(await (await fetch(infos[0].material_uri)).text()).toBe("first")
        unrequestedUrl = infos[1].material_uri
      },
      timeoutMs: 40,
    })

    const failure = await transport
      .dispatchMaterialImport({ media: [first, second], target: "current" })
      .catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(JianyingDeepLinkDispatchError)
    expect(failure).toMatchObject({
      code: "timeout",
      evidence: {
        deepLinkDispatched: true,
        items: [
          { bytes: 5, completed: true, name: "first.png" },
          { bytes: 0, completed: false, name: "second.png" },
        ],
        target: "current",
      },
    })
    expect(await fetch(unrequestedUrl).catch((error: unknown) => error)).toBeInstanceOf(Error)
  })

  test("cancels a dispatched transfer with evidence and closes the loopback server", async () => {
    const root = await temporaryRoot()
    const image = await stagedMedia(root, "cancel.png", "cancel-me", "image", "image/png")
    const controller = new AbortController()
    let mediaUrl = ""
    const transport = new MacOSJianyingDeepLinkTransport({
      openDeepLink: async (deepLink) => {
        mediaUrl = decodeFeatureEntry(deepLink).feature_context.material_infos[0].material_uri
        setTimeout(() => controller.abort(new DOMException("Selection changed", "AbortError")), 10)
      },
      timeoutMs: 5_000,
    })

    const failure = await transport
      .dispatchMaterialImport({ media: [image], target: "current" }, controller.signal)
      .catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(JianyingDeepLinkDispatchError)
    expect(failure).toMatchObject({
      code: "cancelled",
      evidence: {
        deepLinkDispatched: true,
        items: [{ bytes: 0, completed: false, name: "cancel.png" }],
      },
      name: "AbortError",
    })
    expect(await fetch(mediaUrl).catch((error: unknown) => error)).toBeInstanceOf(Error)
  })

  test("validates staged media before dispatch", async () => {
    const root = await temporaryRoot()
    const filePath = path.join(root, "wrong.bin")
    await fs.writeFile(filePath, "data")
    let opened = false
    const transport = new MacOSJianyingDeepLinkTransport({
      openDeepLink: async () => {
        opened = true
      },
    })

    const failure = await transport
      .dispatchMaterialImport({
        media: [{ mediaType: "image", mimeType: "video/mp4", name: "wrong.bin", path: filePath }],
        target: "current",
      })
      .catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(Error)
    if (!(failure instanceof Error)) throw new Error("Expected validation error")
    expect(failure.message).toContain("does not match")
    expect(opened).toBe(false)
  })
})

test("the production launcher rejects non-JianYing URLs before spawning", async () => {
  const failure = await openMacOSJianyingDeepLink("https://example.com/").catch((error: unknown) => error)
  expect(failure).toBeInstanceOf(Error)
  if (!(failure instanceof Error)) throw new Error("Expected launcher error")
  expect(failure.message).toContain("unexpected JianYing Deep Link")
})
