import { describe, expect, mock, test } from "bun:test"
import { createRequire } from "node:module"
import type { DevEnvironment, HotUpdateOptions } from "vite"
import desktopViteConfig, {
  assertPackagedRuntimeBundle,
  assertSandboxedPreloadBundle,
  desktopPreloadInputs,
  desktopRendererInputs,
  isWorkspaceDistPath,
  workspaceDistFullReloadPlugin,
} from "./electron.vite.config"

const require = createRequire(import.meta.url)

describe("Desktop Main dependency packaging", () => {
  test("bundles every Main and preload dependency because packaged apps omit node_modules", () => {
    if (typeof desktopViteConfig === "function") throw new Error("Expected a static Electron Vite config")
    expect(desktopViteConfig.main?.build?.externalizeDeps).toBe(false)
    expect(desktopViteConfig.preload?.build?.externalizeDeps).toBe(false)
  })

  test("keeps the CommonJS Main output and package entry aligned", () => {
    if (typeof desktopViteConfig === "function") throw new Error("Expected a static Electron Vite config")
    const output = desktopViteConfig.main?.build?.rollupOptions?.output
    if (!output || Array.isArray(output)) throw new Error("Expected one Desktop Main output")
    const manifest = require("./package.json") as { main?: string }

    expect(output).toMatchObject({ entryFileNames: "[name].cjs", format: "cjs" })
    expect(manifest.main).toBe("./out/main/index.cjs")
  })

  test("rejects static or dynamic package imports left in packaged output", () => {
    expect(() =>
      assertPackagedRuntimeBundle(
        {
          "index.js": {
            dynamicImports: ["@convax/plugin-sdk/client"],
            imports: ["@convax/marketplace"],
            isEntry: true,
            type: "chunk",
          },
        },
        "Main",
      ),
    ).toThrow("@convax/marketplace, @convax/plugin-sdk/client")
  })

  test("rejects a real package require but ignores require-shaped generated-code strings", () => {
    expect(() =>
      assertPackagedRuntimeBundle(
        {
          "index.cjs": {
            code: 'const generated = \'require("ajv/dist/runtime/uri").default\'; require("@convax/marketplace")',
            imports: [],
            isEntry: true,
            type: "chunk",
          },
        },
        "Main",
      ),
    ).toThrow("@convax/marketplace")
    expect(() =>
      assertPackagedRuntimeBundle(
        {
          "index.cjs": {
            code: 'const generated = \'require("ajv/dist/runtime/uri").default\'; require("node:path")',
            imports: [],
            isEntry: true,
            type: "chunk",
          },
        },
        "Main",
      ),
    ).not.toThrow()
  })

  test("rejects unresolved require.resolve and computed dynamic imports", () => {
    expect(() =>
      assertPackagedRuntimeBundle(
        {
          "index.cjs": {
            code: 'const entry = require.resolve("@convax/marketplace"); import(entry)',
            imports: [],
            isEntry: true,
            type: "chunk",
          },
        },
        "Main",
      ),
    ).toThrow("@convax/marketplace, <dynamic import>")
  })

  test("allows only emitted chunks plus Electron and Node host modules", () => {
    expect(() =>
      assertPackagedRuntimeBundle(
        {
          "chunks/shared.js": { imports: [], isEntry: false, type: "chunk" },
          "index.js": {
            dynamicImports: ["./chunks/lazy.js", "node:fs/promises"],
            imports: ["chunks/shared.js", "electron", "electron/main", "fs", "node:path"],
            isEntry: true,
            type: "chunk",
          },
        },
        "Main",
      ),
    ).not.toThrow()
  })
})

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

    const result = await hotUpdate.call({ environment: { hot: { send } } as unknown as DevEnvironment }, {
      file: "/repo/packages/canvas/dist/index.js",
    } as HotUpdateOptions)

    expect(result).toEqual([])
    expect(send).toHaveBeenCalledWith({ path: "*", type: "full-reload" })
  })

  test("leaves renderer source updates on normal React Fast Refresh", async () => {
    const send = mock(() => undefined)
    const plugin = workspaceDistFullReloadPlugin()
    const hotUpdate = plugin.hotUpdate
    if (typeof hotUpdate !== "function") throw new Error("Workspace dist reload hook is missing")

    const result = await hotUpdate.call({ environment: { hot: { send } } as unknown as DevEnvironment }, {
      file: "/repo/packages/desktop/src/renderer/index.tsx",
    } as HotUpdateOptions)

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
