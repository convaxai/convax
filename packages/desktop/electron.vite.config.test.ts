import { describe, expect, mock, test } from "bun:test"
import type { DevEnvironment, HotUpdateOptions } from "vite"
import {
  assertSandboxedPreloadBundle,
  desktopPreloadInputs,
  desktopRendererInputs,
  isWorkspaceDistPath,
  workspaceDistFullReloadPlugin,
} from "./electron.vite.config"

describe("Desktop workspace dependency hot updates", () => {
  test("recognizes only built workspace package output across host path formats", () => {
    expect(isWorkspaceDistPath("/repo/packages/canvas/dist/index.js")).toBe(true)
    expect(isWorkspaceDistPath("C:\\repo\\packages\\canvas\\dist\\index.js")).toBe(true)
    expect(isWorkspaceDistPath("/repo/packages/canvas/src/index.ts")).toBe(false)
    expect(isWorkspaceDistPath("/repo/node_modules/dependency/dist/index.js")).toBe(false)
  })

  test("replaces workspace dist HMR with a full renderer reload", async () => {
    const send = mock(() => undefined)
    const plugin = workspaceDistFullReloadPlugin()
    const hotUpdate = plugin.hotUpdate
    if (typeof hotUpdate !== "function") throw new Error("Workspace dist reload hook is missing")

    const result = await hotUpdate.call(
      { environment: { hot: { send } } as unknown as DevEnvironment },
      { file: "/repo/packages/canvas/dist/index.js" } as HotUpdateOptions,
    )

    expect(result).toEqual([])
    expect(send).toHaveBeenCalledWith({ path: "*", type: "full-reload" })
  })

  test("leaves renderer source updates on normal React Fast Refresh", async () => {
    const send = mock(() => undefined)
    const plugin = workspaceDistFullReloadPlugin()
    const hotUpdate = plugin.hotUpdate
    if (typeof hotUpdate !== "function") throw new Error("Workspace dist reload hook is missing")

    const result = await hotUpdate.call(
      { environment: { hot: { send } } as unknown as DevEnvironment },
      { file: "/repo/packages/desktop/src/renderer/index.tsx" } as HotUpdateOptions,
    )

    expect(result).toBeUndefined()
    expect(send).not.toHaveBeenCalled()
  })
})

describe("sandboxed Desktop preload bundles", () => {
  test("rejects an emitted shared chunk required by a preload entry", () => {
    expect(() =>
      assertSandboxedPreloadBundle({
        "chunks/contracts.cjs": { imports: [], isEntry: false, type: "chunk" },
        "index.js": { imports: ["electron", "chunks/contracts.cjs"], isEntry: true, type: "chunk" },
      }),
    ).toThrow("must be self-contained")
  })

  test("accepts self-contained preload entries and non-chunk assets", () => {
    expect(() =>
      assertSandboxedPreloadBundle({
        "index.js": { imports: ["electron"], isEntry: true, type: "chunk" },
        "pet.js": { imports: ["electron"], isEntry: true, type: "chunk" },
        "pet.txt": { type: "asset" },
      }),
    ).not.toThrow()
  })
})

describe("Pet Plugin overlay build boundary", () => {
  test("keeps the fixed Pet connector preload but removes the host-owned Pet renderer", () => {
    expect(desktopPreloadInputs).toMatchObject({ pet: "src/preload/pet.ts" })
    expect(desktopRendererInputs).toEqual({
      index: "src/renderer/index.html",
    })
  })

  test("binds the fixed connector port to the exact current Plugin document", async () => {
    type ConnectListener = (event: { ports: Array<{ close(): void }> }, envelope: unknown) => void

    let listener: ConnectListener | undefined
    const ipcOn = mock((_channel: string, next: ConnectListener) => {
      listener = next
    })
    mock.module("electron", () => ({ ipcRenderer: { on: ipcOn } }))

    const location = { hostname: "beta-pet", protocol: "convax-plugin:" }
    const postMessage = mock(() => undefined)
    const overlayWindow = { location, postMessage } as unknown as Window & typeof globalThis
    Object.defineProperty(overlayWindow, "top", { value: overlayWindow })
    const previousWindow = globalThis.window
    Object.defineProperty(globalThis, "window", { configurable: true, value: overlayWindow })

    try {
      await import("./src/preload/pet")
      const connect = listener
      if (!connect) throw new Error("Pet connector listener was not registered")

      const envelope = {
        pluginId: "alpha-pet",
        protocol: "convax.pet-host/1",
        surface: "overlay",
        type: "connect",
      }
      for (const deniedLocation of [
        { hostname: "beta-pet", protocol: "convax-plugin:" },
        { hostname: "alpha-pet", protocol: "file:" },
        { hostname: "alpha-pet", protocol: "https:" },
        { hostname: "", protocol: "about:" },
      ]) {
        Object.assign(location, deniedLocation)
        const close = mock(() => undefined)
        connect({ ports: [{ close }] }, envelope)
        expect(postMessage).not.toHaveBeenCalled()
        expect(close).toHaveBeenCalledTimes(1)
      }

      Object.assign(location, { hostname: "alpha-pet", protocol: "convax-plugin:" })
      const port = { close: mock(() => undefined) }
      connect({ ports: [port] }, envelope)
      expect(postMessage).toHaveBeenCalledTimes(1)
      expect(postMessage).toHaveBeenCalledWith(envelope, "*", [port])
      expect(port.close).not.toHaveBeenCalled()

      const duplicatePort = { close: mock(() => undefined) }
      connect({ ports: [duplicatePort] }, envelope)
      expect(postMessage).toHaveBeenCalledTimes(1)
      expect(duplicatePort.close).toHaveBeenCalledTimes(1)
    } finally {
      if (previousWindow === undefined) {
        Reflect.deleteProperty(globalThis, "window")
      } else {
        Object.defineProperty(globalThis, "window", { configurable: true, value: previousWindow })
      }
    }
  })
})
