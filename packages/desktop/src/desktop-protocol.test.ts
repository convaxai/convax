import { describe, expect, test } from "bun:test"
import {
  canvasResourceIpcChannel,
  canvasResourceHydrateStaleIpcChannel,
  canvasResourceReadConnectedImageIpcChannel,
  canvasTextResourceIpcChannel,
  checkDesktopProtocol,
  desktopProtocolVersion,
} from "./desktop-protocol"
import { workspaceSystemStatusIpcChannel } from "./workspace-system-status-contracts"

describe("desktop IPC protocol compatibility", () => {
  test("tracks the Desktop preload bridge contract", () => {
    expect(desktopProtocolVersion).toBe("convax.desktop-ipc/31")
    expect(workspaceSystemStatusIpcChannel).toBe("desktop:workspace-system-status")
    expect(canvasResourceIpcChannel).toBe("canvas:resource-add")
    expect(canvasResourceHydrateStaleIpcChannel).toBe("canvas:resource-hydrate-stale")
    expect(canvasResourceReadConnectedImageIpcChannel).toBe("canvas:resource-read-connected-image")
    expect(canvasTextResourceIpcChannel).toBe("canvas:text-resource-save")
  })

  test("accepts a matching main, preload, and renderer protocol", async () => {
    await expect(
      checkDesktopProtocol(
        {
          getVersion: async () => "protocol/2",
          version: "protocol/2",
        },
        "protocol/2",
      ),
    ).resolves.toEqual({
      actualVersion: "protocol/2",
      expectedVersion: "protocol/2",
      status: "compatible",
    })
  })

  test("requires a restart when the preload bridge or main endpoint is missing", async () => {
    await expect(checkDesktopProtocol(undefined, "protocol/2")).resolves.toEqual({
      expectedVersion: "protocol/2",
      status: "missing",
    })

    const unavailable = await checkDesktopProtocol(
      {
        getVersion: async () => {
          throw new Error("No handler registered for 'desktop:protocol-version'")
        },
        version: "protocol/2",
      },
      "protocol/2",
    )
    expect(unavailable).toMatchObject({ expectedVersion: "protocol/2", status: "missing" })
  })

  test("requires a restart when desktop protocol versions differ", async () => {
    await expect(
      checkDesktopProtocol(
        {
          getVersion: async () => "protocol/1",
          version: "protocol/2",
        },
        "protocol/2",
      ),
    ).resolves.toEqual({
      actualVersion: "protocol/1",
      component: "main",
      expectedVersion: "protocol/2",
      status: "mismatch",
    })

    await expect(
      checkDesktopProtocol(
        {
          getVersion: async () => "protocol/2",
          version: "protocol/1",
        },
        "protocol/2",
      ),
    ).resolves.toEqual({
      actualVersion: "protocol/1",
      component: "preload",
      expectedVersion: "protocol/2",
      status: "mismatch",
    })
  })
})
