const isolatedModuleMockTests = [
  "electron.vite.config.test.ts",
  "src/main/canvas-external-media-drag-ipc.test.ts",
  "src/main/electron-plugin-service-browser-authorization.test.ts",
  "src/main/main-window-controls-ipc.test.ts",
  "src/main/plugin-capability-ipc.test.ts",
  "src/main/workspace-system-status-ipc.test.ts",
  "src/renderer/canvas-card-conversation-panel-interaction.test.tsx",
  "src/renderer/pet-settings-host.test.tsx",
] as const

async function runTests(files: readonly string[]) {
  const process = Bun.spawn({
    cmd: [Bun.argv[0]!, "test", "--isolate", ...files],
    cwd: import.meta.dir + "/..",
    stderr: "inherit",
    stdout: "inherit",
  })
  return process.exited
}

const isolatedSet = new Set<string>(isolatedModuleMockTests)
const regularTests: string[] = []
const testFiles = new Bun.Glob("**/*.test.{ts,tsx}")
for await (const file of testFiles.scan({ cwd: import.meta.dir + "/..", onlyFiles: true })) {
  if (!isolatedSet.has(file)) regularTests.push(file)
}
regularTests.sort()

let exitCode = await runTests(regularTests)
if (exitCode === 0) {
  for (const file of isolatedModuleMockTests) {
    exitCode = await runTests([file])
    if (exitCode !== 0) break
  }
}

process.exit(exitCode)
