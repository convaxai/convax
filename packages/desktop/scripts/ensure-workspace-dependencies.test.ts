import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { describe, expect, test } from "bun:test"
import { ensureWorkspaceDependencies } from "./ensure-workspace-dependencies"

const desktopDirectory = join(import.meta.dir, "..")
const repositoryRoot = join(desktopDirectory, "../..")

describe("Desktop workspace dependency build", () => {
  test("builds every workspace dependency through Turbo before a direct Desktop task", async () => {
    const calls: Array<{ command: readonly string[]; cwd: string }> = []

    const built = await ensureWorkspaceDependencies({
      managedByTurbo: false,
      repositoryRoot: "/repo",
      run: async (command, cwd) => {
        calls.push({ command, cwd })
        return 0
      },
    })

    expect(built).toBe(true)
    expect(calls).toEqual([
      {
        command: [process.execPath, "turbo", "build", "--filter=@convax/desktop^...", "--concurrency=1"],
        cwd: "/repo",
      },
    ])
  })

  test("uses the parent Turbo task's dependency graph instead of nesting Turbo", async () => {
    let called = false

    const built = await ensureWorkspaceDependencies({
      managedByTurbo: true,
      run: async () => {
        called = true
        return 0
      },
    })

    expect(built).toBe(false)
    expect(called).toBe(false)
  })

  test("fails the Desktop task when a dependency build fails", async () => {
    await expect(
      ensureWorkspaceDependencies({
        managedByTurbo: false,
        run: async () => 17,
      }),
    ).rejects.toThrow("Workspace dependency build failed with exit code 17")
  })

  test("guards both direct entrypoints and keeps Turbo's dependency contract", async () => {
    const desktopPackage: unknown = JSON.parse(await readFile(join(desktopDirectory, "package.json"), "utf8"))
    const rootPackage: unknown = JSON.parse(await readFile(join(repositoryRoot, "package.json"), "utf8"))
    const turbo: unknown = JSON.parse(await readFile(join(repositoryRoot, "turbo.json"), "utf8"))

    expect(desktopPackage).toMatchObject({
      scripts: {
        build: expect.stringMatching(/^bun run build:workspace-dependencies && /),
        dev: expect.stringMatching(/^bun run build:workspace-dependencies && /),
      },
    })
    expect(rootPackage).toMatchObject({
      scripts: {
        "dev:desktop": "bun turbo dev --filter=@convax/desktop",
      },
    })
    expect(turbo).toMatchObject({
      tasks: {
        "@convax/desktop#dev": {
          env: expect.arrayContaining([
            "CONVAX_ALLOW_MULTIPLE_INSTANCES",
            "CONVAX_SOLO_TASK_ID",
            "CONVAX_SOLO_TASK_LABEL",
            "CONVAX_USER_DATA_DIR",
          ]),
        },
        build: { dependsOn: expect.arrayContaining(["^build"]) },
        dev: { dependsOn: expect.arrayContaining(["^build"]) },
      },
    })
    const desktopBuildEnvironment = (turbo as { tasks: { "@convax/desktop#build": { env: readonly string[] } } }).tasks[
      "@convax/desktop#build"
    ].env
    expect(desktopBuildEnvironment).not.toContain("CONVAX_SOLO_TASK_ID")
    expect(desktopBuildEnvironment).not.toContain("CONVAX_SOLO_TASK_LABEL")
    expect(desktopBuildEnvironment).not.toContain("CONVAX_USER_DATA_DIR")
  })
})
