import { afterEach, describe, expect, mock, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { createCanvasDocument, createCanvasSelectionActionContext, createMediaNode } from "@convax/canvas"
import { projectFileReferenceKey } from "@convax/project/canvas"

import type { JianyingRendererClient } from "../jianying-contracts"
import { canExportSelectionToJianying, exportCanvasMediaToJianying } from "../renderer/jianying-selection-action"
import { JianyingCanvasService } from "./jianying-canvas-service"
import { MacOSJianyingDeepLinkTransport } from "./jianying-deeplink"
import { JianyingIntegrationService, MacOSJianyingNativeAdapter, type JianyingCommandRunner } from "./jianying-service"

type InvokeHandler = (event: TestEvent, input?: unknown) => unknown
type EventHandler = (event: TestEvent, input?: unknown) => void

interface TestSender {
  id: number
  once(event: string, listener: () => void): void
  removeListener(event: string, listener: () => void): void
}

interface TestEvent {
  sender: TestSender
}

interface FeatureEntry {
  feature_context: {
    material_import: boolean
    material_infos: Array<{
      material_param: { add_to_material_panel: boolean }
      material_uri: string
    }>
  }
  sence_context?: { material_import_by_user: boolean; new_draft: boolean }
}

const handlers = new Map<string, InvokeHandler>()
const listeners = new Map<string, EventHandler>()
const temporaryRoots: string[] = []

mock.module("electron", () => ({
  ipcMain: {
    handle: (channel: string, handler: InvokeHandler) => handlers.set(channel, handler),
    on: (channel: string, listener: EventHandler) => listeners.set(channel, listener),
    removeHandler: (channel: string) => handlers.delete(channel),
    removeListener: (channel: string) => listeners.delete(channel),
  },
}))

afterEach(async () => {
  handlers.clear()
  listeners.clear()
  await Promise.all(temporaryRoots.splice(0).map((root) => fs.rm(root, { force: true, recursive: true })))
})

function sender(id: number): TestSender {
  const events = new Map<string, Set<() => void>>()
  return {
    id,
    once(event, listener) {
      const current = events.get(event) ?? new Set()
      current.add(listener)
      events.set(event, current)
    },
    removeListener(event, listener) {
      events.get(event)?.delete(listener)
    },
  }
}

function decodeFeatureEntry(deepLink: string): FeatureEntry {
  const url = new URL(deepLink)
  expect(url.protocol).toBe("videocut:")
  expect(url.hostname).toBe("com.ies.videocut")
  expect(url.pathname).toBe("/uganchor/anchor_point/nothing")
  const featureEntry = url.searchParams.get("featureEntry")
  if (!featureEntry) throw new Error("The JianYing Deep Link did not contain featureEntry")
  return JSON.parse(featureEntry) as FeatureEntry
}

describe("JianYing toolbar integration", () => {
  test("sends selected image and video bytes to the active draft through IPC and one Deep Link", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "convax-jianying-toolbar-"))
    temporaryRoots.push(root)
    const assetsRoot = path.join(root, ".convax", "assets")
    const imagePath = path.join(assetsRoot, "frame.png")
    const videoPath = path.join(assetsRoot, "clip.mp4")
    const draftPath = path.join(root, "drafts", "Temporary")
    const imageBytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3])
    const videoBytes = Buffer.concat([Buffer.from([0, 0, 0, 20]), Buffer.from("ftypisomvideo")])
    await fs.mkdir(assetsRoot, { recursive: true })
    await fs.mkdir(draftPath, { recursive: true })
    await fs.writeFile(imagePath, imageBytes)
    await fs.writeFile(videoPath, videoBytes)
    await fs.writeFile(path.join(draftPath, ".locked"), "")
    await fs.writeFile(path.join(draftPath, "draft_info.json"), "{}")
    const lockPath = await fs.realpath(path.join(draftPath, ".locked"))

    const nativeCommands: string[] = []
    const commandRunner: JianyingCommandRunner = async (executable) => {
      nativeCommands.push(executable)
      if (executable === "/bin/ps") {
        return {
          exitCode: 0,
          stderr: "",
          stdout: "42 /Applications/VideoFusion-macOS.app/Contents/MacOS/VideoFusion-macOS\n",
        }
      }
      if (executable === "/usr/sbin/lsof") {
        return { exitCode: 0, stderr: "", stdout: `p42\0\nf1\0n${lockPath}\0\n` }
      }
      throw new Error(`Unexpected native command: ${executable}`)
    }

    let deepLinkCount = 0
    let featureEntry: FeatureEntry | undefined
    const receivedBytes: Buffer[] = []
    const transport = new MacOSJianyingDeepLinkTransport({
      openDeepLink: async (deepLink) => {
        deepLinkCount += 1
        featureEntry = decodeFeatureEntry(deepLink)
        for (const material of featureEntry.feature_context.material_infos) {
          expect(material.material_param).toEqual({ add_to_material_panel: true })
          const mediaUrl = new URL(material.material_uri)
          expect(mediaUrl.hostname).toBe("127.0.0.1")
          const response = await fetch(mediaUrl)
          expect(response.status).toBe(200)
          receivedBytes.push(Buffer.from(await response.arrayBuffer()))
        }
      },
    })
    const integration = new JianyingIntegrationService(
      new MacOSJianyingNativeAdapter({
        commandRunner,
        platform: "darwin",
        sleep: async () => {},
        transport,
      }),
      path.join(root, "staging"),
    )

    const image = createMediaNode({
      id: "image-1",
      position: { x: 0, y: 0 },
      resource: {
        id: "image-resource",
        kind: "image",
        metadata: { [projectFileReferenceKey]: { path: ".convax/assets/frame.png" } },
        name: "Frame",
        url: "convax-asset://project/frame.png",
      },
    })
    const video = createMediaNode({
      id: "video-1",
      position: { x: 20, y: 0 },
      resource: {
        id: "video-resource",
        kind: "video",
        metadata: { [projectFileReferenceKey]: { path: ".convax/assets/clip.mp4" } },
        name: "Clip",
        url: "convax-asset://project/clip.mp4",
      },
    })
    const document = {
      ...createCanvasDocument({ id: "canvas-1", title: "Canvas" }),
      nodes: [image, video],
      revision: 7,
    }
    const canvas = new JianyingCanvasService({
      documents: { load: async () => ({ document, storageVersion: "v1" }) },
      integration,
      isEnabled: async () => true,
      projects: {
        readFileInfo: async ({ path: resourcePath }) => ({
          mimeType: resourcePath.endsWith(".mp4") ? "video/mp4" : "image/png",
          name: path.basename(resourcePath),
          path: resourcePath,
          size: resourcePath.endsWith(".mp4") ? videoBytes.length : imageBytes.length,
        }),
        resolveEntryPath: async ({ path: resourcePath }) => path.join(root, resourcePath),
      },
    })

    const { jianyingIpcChannels, registerJianyingIpc } = await import("./jianying-ipc")
    const renderer = sender(1)
    const dispose = registerJianyingIpc(canvas, {
      isTrustedSender: (event) => event.sender.id === renderer.id,
      resolveActiveCanvas: async () => ({ canvasId: document.id, revision: document.revision, scopeId: "project-1" }),
    })
    const invoke = (channel: string, input?: unknown) => {
      const handler = handlers.get(channel)
      if (!handler) throw new Error(`Missing IPC handler: ${channel}`)
      return handler({ sender: renderer }, input)
    }
    const client: JianyingRendererClient = {
      cancelCanvasMediaExport: (input) =>
        listeners.get(jianyingIpcChannels.cancelCanvasMediaExport)?.({ sender: renderer }, input),
      exportCanvasMedia: (input) =>
        Promise.resolve(invoke(jianyingIpcChannels.exportCanvasMedia, input)) as ReturnType<
          JianyingRendererClient["exportCanvasMedia"]
        >,
      getDraftStatus: () =>
        Promise.resolve(invoke(jianyingIpcChannels.getDraftStatus)) as ReturnType<
          JianyingRendererClient["getDraftStatus"]
        >,
    }
    const controller = new AbortController()
    const context = createCanvasSelectionActionContext(document, ["image-1", "video-1"], [], controller.signal)
    expect(canExportSelectionToJianying(context)).toBe(true)

    await expect(
      exportCanvasMediaToJianying(
        client,
        {
          expectedRevision: document.revision,
          nodeIds: ["image-1", "video-1"],
          ref: { canvasId: document.id, scopeId: "project-1" },
          target: { kind: "current-or-new" },
        },
        controller.signal,
      ),
    ).resolves.toEqual({
      createdDraft: false,
      draftName: "Temporary",
      importedMediaCount: 2,
      importStatus: "dispatched",
    })

    expect(deepLinkCount).toBe(1)
    expect(featureEntry?.feature_context.material_import).toBe(true)
    expect(featureEntry?.sence_context).toEqual({ material_import_by_user: true, new_draft: false })
    expect(receivedBytes).toEqual([imageBytes, videoBytes])
    expect(new Set(nativeCommands)).toEqual(new Set(["/bin/ps", "/usr/sbin/lsof"]))
    expect(nativeCommands).not.toContain("/usr/bin/osascript")
    dispose()
  })
})
