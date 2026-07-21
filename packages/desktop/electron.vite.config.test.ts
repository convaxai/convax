import { describe, expect, mock, test } from "bun:test"
import type { DevEnvironment, HotUpdateOptions } from "vite"
import { isWorkspaceDistPath, workspaceDistFullReloadPlugin } from "./electron.vite.config"

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
