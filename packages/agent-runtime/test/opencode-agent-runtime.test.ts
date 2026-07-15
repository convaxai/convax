import { describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  buildCanvasPromptNote,
  OpenCodeAgentRuntime,
  prepareAgentResourceParts,
  withConvaxPrivateStoragePermissions,
} from "../src/node/opencode-agent-runtime"

describe("Convax OpenCode boundaries", () => {
  test("provides the exact active Canvas identity to the tool-using model", () => {
    const note = buildCanvasPromptNote({
      activeCanvas: { canvasId: "canvas-main", name: "Canvas 1" },
      canvasAttached: false,
      canvasToolsAvailable: true,
    })

    expect(note).toContain('Active Canvas ID: "canvas-main"')
    expect(note).toContain('Active Canvas name: "Canvas 1"')
    expect(note).toContain("pass exactly this Canvas ID")
    expect(note).toContain("not private .convax files")
  })

  test("merges private-storage denies with caller permissions without mutation", () => {
    const config = {
      model: "provider/model",
      permission: {
        bash: "ask" as const,
        edit: "allow" as const,
        read: { "*": "ask" as const, ".convax/**": "allow" as const },
      },
    }

    const merged = withConvaxPrivateStoragePermissions(config)

    expect(merged).not.toBe(config)
    expect(merged.model).toBe("provider/model")
    expect(config.permission.read[".convax/**"]).toBe("allow")
    expect(merged.permission).toMatchObject({ bash: "ask" })
    expect(typeof merged.permission).toBe("object")
    if (typeof merged.permission !== "object") throw new Error("Expected permission object")
    expect(merged.permission.read).toMatchObject({ "*": "ask", ".convax/**": "deny", "**/.convax/**": "deny" })
    expect(merged.permission.edit).toMatchObject({ "*": "allow", ".convax/**": "deny", "**/.convax/**": "deny" })
  })

  test("preserves a global permission fallback while protecting Canvas storage", () => {
    const merged = withConvaxPrivateStoragePermissions({ permission: "ask" })
    if (typeof merged.permission !== "object") throw new Error("Expected permission object")
    expect(merged.permission["*"]).toBe("ask")
    expect(merged.permission.read).toMatchObject({ "*": "ask", ".convax/**": "deny" })
    expect(merged.permission.edit).toMatchObject({ "*": "ask", ".convax/**": "deny" })
  })

  test("does not discover executable extensions from an opened project", async () => {
    const directory = await mkdtemp(join(tmpdir(), "convax-opencode-boundary-"))
    const toolDirectory = join(directory, ".opencode", "tools")
    const skillDirectory = join(directory, ".opencode", "skills", "project-extension-probe")
    await mkdir(toolDirectory, { recursive: true })
    await mkdir(skillDirectory, { recursive: true })
    await writeFile(join(toolDirectory, "project_extension_probe.ts"), [
      "export default {",
      "  description: 'Project extension probe',",
      "  args: {},",
      "  execute: async () => 'loaded',",
      "}",
    ].join("\n"))
    await writeFile(join(skillDirectory, "SKILL.md"), [
      "---",
      "name: project-extension-probe",
      "description: Project extension probe",
      "---",
      "",
      "This project-local skill must remain outside the Convax runtime boundary.",
    ].join("\n"))

    const runtime = new OpenCodeAgentRuntime({ timeout: 15_000 })
    try {
      const capabilities = await runtime.listCapabilities({ directory })
      expect(capabilities.toolIds).not.toContain("project_extension_probe")
      expect(capabilities.skills.map((skill) => skill.name)).not.toContain("project-extension-probe")
    } finally {
      await runtime.dispose()
      await rm(directory, { force: true, recursive: true })
    }
  }, 20_000)

  test("creates a pathless data attachment from a prepared Canvas snapshot", async () => {
    const content = JSON.stringify({ id: "canvas-1", nodes: [] })
    const [part] = await prepareAgentResourceParts("/directory/that/does/not/exist", [{
      canvasId: "canvas-1",
      content,
      kind: "canvas",
      mime: "application/json",
      name: "Blank",
    }])

    expect(part?.filename).toBe("Blank.canvas.json")
    expect(part?.mime).toBe("application/json")
    expect(part?.source).toBeUndefined()
    expect(part?.url.startsWith("data:application/json;base64,")).toBe(true)
    expect(Buffer.from(part!.url.split(",")[1]!, "base64").toString("utf8")).toBe(content)
  })
})
