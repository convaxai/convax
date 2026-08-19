import { describe, expect, test } from "bun:test"
import { join } from "node:path"

const desktopRoot = join(import.meta.dir, "../..")

describe("ordinary Desktop DSH composition", () => {
  test("routes product Agent IPC through Project DSH processes and connected Service providers", async () => {
    const source = await Bun.file(join(import.meta.dir, "index.ts")).text()
    expect(source).toContain("new DshProjectProcessRegistry")
    expect(source).toContain("new DeepSeekHarnessProjectRuntime")
    expect(source).toContain("generationRuntime.connectLlmProviders()")
    expect(source).toContain("providers,")
    expect(source).toContain("agentToolServer.registerScope({ directory, scopeId })")
    expect(source).toContain("await agentRuntime.closeProject(projectId)")
    expect(source).not.toContain("OpenCodeAgentRuntime")
    expect(source).not.toContain("desktopOpenCodeBinaryDirectory")
    expect(source).toContain("@convax/agent-runtime/node/deepseek-harness-project-runtime")
  })

  test("stages DSH in ordinary dev and product packaging without an OpenCode dependency", async () => {
    const [desktopPackage, runtimePackage, rootPackage] = await Promise.all(
      [
        join(desktopRoot, "package.json"),
        join(desktopRoot, "..", "agent-runtime", "package.json"),
        join(desktopRoot, "..", "..", "package.json"),
      ].map(async (path) => JSON.parse(await Bun.file(path).text()) as Record<string, unknown>),
    )
    const scripts = desktopPackage.scripts as Record<string, string>
    expect(scripts.dev).toContain("stage-packaged-dsh-runtime.ts")
    expect(scripts["package:prepare"]).toContain("stage-packaged-dsh-runtime.ts")
    expect(JSON.stringify(runtimePackage)).not.toContain("opencode-ai")
    expect(rootPackage.trustedDependencies).not.toContain("opencode-ai")
  })

  test("keeps the DSH boot graph out of the ordinary Electron Main dependency surface", async () => {
    const nodeIndex = await Bun.file(join(desktopRoot, "..", "agent-runtime", "src", "node", "index.ts")).text()
    expect(nodeIndex).not.toContain('export * from "./deepseek-harness-agent-runtime"')
    expect(nodeIndex).toContain("export type {")
  })

  test("does not require a third-party Service to be online for packaged DSH startup proof", async () => {
    const smoke = await Bun.file(join(desktopRoot, "scripts", "desktop-packaged-smoke.ts")).text()
    expect(smoke).toContain("validCount(agent.providerCount)")
    expect(smoke).not.toContain("!agent.providerCount")
    expect(smoke).not.toContain("!agent.modelCount")
  })
})
